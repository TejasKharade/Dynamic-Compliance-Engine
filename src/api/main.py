from __future__ import annotations

import json
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from src.core.compliance_evaluator import evaluate_inventory, evaluate_inventory_from_db
from src.database.neo4j_client import Neo4jClient
from src.ingestion.text_extractor import extract_rules_from_file
from src.schemas import ComplianceGraphDocument, DeviceComplianceReport, ComplianceFinding
from src.agent.compliance_react_agent import ask_agent

# Product Policy Imports
from src.policy_schemas import PolicyComplianceReport
from src.core.policy_rag_evaluator import build_policy_vectorstore, evaluate_device_rag
from src.agent.tools.policy_rag_tool import set_global_policy_rag_store
from src.agent.policy_report_store import (
    clear_policy_reports,
    register_policy_report,
    get_all_policy_reports_with_inventory,
)
 
from src.agent.report_store import (
    clear_reports,
    register_report,
    list_report_ids,
    count_reports,
    get_all_reports,
    get_all_reports_with_inventory,
    get_inventory_for_device,
    find_report,
)
from src.ingestion.file_parsers import parse_inventory_file
from src.ingestion.normalizer import InventoryNormalizer

# --------------- Vocabulary Cache ---------------
_vocabulary_cache: set[str] | None = None

def _get_vocabulary() -> set[str]:
    global _vocabulary_cache
    if _vocabulary_cache is None:
        with Neo4jClient() as db:
            _vocabulary_cache = db.get_global_vocabulary()
    return _vocabulary_cache

def clear_vocabulary_cache() -> None:
    global _vocabulary_cache
    _vocabulary_cache = None


app = FastAPI(
    title="Dynamic Compatibility & Configuration Compliance Engine",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Request / Response Models ----------

class EvaluateRequest(BaseModel):
    graph: ComplianceGraphDocument
    inventory: list[dict[str, Any]] = Field(
        description="List of device inventory records"
    )


class ChatRequest(BaseModel):
    session_id: str = Field(default="default")
    question: str


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    tools_used: list[str] = Field(default_factory=list)


class ViolationOut(BaseModel):
    rule_id: str | None = None
    severity: str
    message: str
    explanation: str | None = None
    components: list[str] | None = None


class RemediationSubStep(BaseModel):
    order: int
    description: str
    command: str | None = None
    warning: str | None = None
    note: str | None = None


class RemediationStepOut(BaseModel):
    order: int | None = None
    action: str
    component: str | None = None
    target_version: str | None = None
    reason: str | None = None
    estimated_time: str | None = None
    risk: str | None = None
    sub_steps: list[RemediationSubStep] = Field(default_factory=list)


class DeviceSpecOut(BaseModel):
    component: str
    version: str
    source: str = "auto"
    confidence: float | None = None


class DeviceEvaluationOut(BaseModel):
    device_id: str
    name: str | None = None
    compliance_score: int
    is_compliant: bool
    last_evaluated: str | None = None
    violations: list[ViolationOut] = Field(default_factory=list)
    remediation: list[RemediationStepOut] = Field(default_factory=list)
    specs: list[DeviceSpecOut] = Field(default_factory=list)


class EvaluationResponseOut(BaseModel):
    devices: list[DeviceEvaluationOut]


class PolicyEvaluationResponseOut(BaseModel):
    devices: list[DeviceEvaluationOut]
    policy_summary: str | None = None



class ExtractedRuleOut(BaseModel):
    component_a: str
    component_b: str | None = None
    relationship: str
    version_constraint: str | None = None
    severity: str | None = None
    confidence: float | None = None


class IngestRulesResponse(BaseModel):
    message: str
    nodes: int
    relationships: int
    rules: list[ExtractedRuleOut]


# ---------- Helpers ----------

def _save_upload_to_tempfile(upload: UploadFile) -> Path:
    suffix = Path(upload.filename or "").suffix or ".tmp"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        shutil.copyfileobj(upload.file, tmp)
    finally:
        tmp.close()
    return Path(tmp.name)


def _load_inventory_json_from_upload(upload: UploadFile) -> list[dict[str, Any]]:
    try:
        raw = upload.file.read()
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, list):
            raise ValueError("Inventory JSON must be a list of device objects.")
        return data
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid inventory JSON: {exc}")


def _build_sub_steps(
    action: str,
    component: str,
    target_version: str | None,
    reason: str,
    severity: str,
) -> list[RemediationSubStep]:
    """
    Generate detailed, actionable sub-steps based on the remediation action type.
    """
    a = action.lower()

    if "upgrade" in a:
        steps = [
            RemediationSubStep(order=1, description=f"Verify the current installed version of **{component}** on the device.", command=f"Get-WmiObject Win32_Product | Where-Object {{ $_.Name -like '*{component}*' }}"),
            RemediationSubStep(order=2, description=f"Download the latest compatible version{' (' + target_version + ')' if target_version else ''} from the vendor portal or repository."),
            RemediationSubStep(order=3, description="Back up current configuration and create a system restore point before proceeding.", warning="Do not skip this step — rollback may be required if the upgrade causes instability."),
            RemediationSubStep(order=4, description=f"Apply the {component} update using your device management tool (e.g., Dell Command Update, WSUS, or manual installer).", command="DellCommandUpdate.exe /applyUpdates -reboot=disable"),
            RemediationSubStep(order=5, description="Restart the device in a scheduled maintenance window to apply firmware/driver changes.", warning="Ensure no active user sessions or running jobs before rebooting."),
            RemediationSubStep(order=6, description=f"Verify the updated version is active post-reboot and matches the required version{' ' + target_version if target_version else ''}.", command=f"Get-WmiObject Win32_BIOS | Select-Object SMBIOSBIOSVersion"),
            RemediationSubStep(order=7, description="Re-run compliance evaluation to confirm the violation is resolved and score has improved."),
        ]
        return steps

    elif "install" in a:
        return [
            RemediationSubStep(order=1, description=f"Confirm that **{component}** is truly absent from the system.", command=f"Get-WmiObject Win32_Product | Where-Object {{ $_.Name -like '*{component}*' }}"),
            RemediationSubStep(order=2, description=f"Locate the required installer for **{component}**{' version ' + target_version if target_version else ''} from the vendor site or internal repository."),
            RemediationSubStep(order=3, description="Verify the installer checksum/signature to ensure file integrity before execution.", note="SHA-256 checksums are usually listed on the download page."),
            RemediationSubStep(order=4, description=f"Install **{component}** silently via command line or deploy through your endpoint management tool.", command=f"msiexec /i {component}_setup.msi /qn"),
            RemediationSubStep(order=5, description="Restart device if prompted, within a maintenance window."),
            RemediationSubStep(order=6, description="Validate the installation succeeded and the component appears in the installed software list."),
            RemediationSubStep(order=7, description="Re-run the compliance scan to confirm the REQUIRES violation is resolved."),
        ]

    elif "remove" in a or "replace" in a:
        return [
            RemediationSubStep(order=1, description=f"Identify all instances of **{component}** currently installed on the device.", command=f"Get-WmiObject Win32_Product | Where-Object {{ $_.Name -like '*{component}*' }}"),
            RemediationSubStep(order=2, description="Check for active dependencies — ensure no other service or process requires this component before removing.", warning="Removing a component that another service depends on can cause system instability."),
            RemediationSubStep(order=3, description="Document the current configuration of the conflicting component before removal."),
            RemediationSubStep(order=4, description=f"Uninstall **{component}** via Control Panel or command line.", command=f"Get-WmiObject Win32_Product | Where-Object {{ $_.Name -like '*{component}*' }} | ForEach-Object {{ $_.Uninstall() }}"),
            RemediationSubStep(order=5, description="If replacing with a compatible version, install the approved replacement immediately after removal."),
            RemediationSubStep(order=6, description="Restart the device in a maintenance window to finalize removal.", warning="Ensure the conflicting component is fully purged before restarting."),
            RemediationSubStep(order=7, description="Re-run compliance evaluation to verify the CONFLICTS_WITH violation is cleared."),
        ]

    elif "avoid" in a:
        return [
            RemediationSubStep(order=1, description=f"Review the usage context for **{component}** — determine whether it is actively being used or can be safely decommissioned."),
            RemediationSubStep(order=2, description="Consult the vendor advisory for the component to understand the specific risk being flagged.", note=f"Reason: {reason}"),
            RemediationSubStep(order=3, description=f"If **{component}** is not essential, plan its removal in the next maintenance window.", warning="Ensure no active dependencies before removal."),
            RemediationSubStep(order=4, description="If **{component}** must be retained, apply any available mitigating patches or workarounds documented in the vendor advisory."),
            RemediationSubStep(order=5, description="Document the risk acceptance decision if the component cannot be removed, and notify the security team."),
            RemediationSubStep(order=6, description="Re-evaluate the device compliance posture and add a risk exception if necessary."),
        ]

    else:
        # "review" / default — generic investigation steps
        return [
            RemediationSubStep(order=1, description=f"Manually inspect the configuration of **{component}** against the compliance rule.", note=f"Rule context: {reason}"),
            RemediationSubStep(order=2, description="Cross-reference current inventory records with the approved configuration baseline from your CMDB or documentation.", warning="Discrepancies between inventory and actual state are a common source of false compliance readings."),
            RemediationSubStep(order=3, description="If a mismatch is found, determine whether an upgrade, reconfiguration, or exception is appropriate."),
            RemediationSubStep(order=4, description="If an upgrade is required, initiate the upgrade procedure using Dell Command Update or your patch management system.", command="DellCommandUpdate.exe /applyUpdates"),
            RemediationSubStep(order=5, description="Update the device inventory record to reflect the correct version post-remediation."),
            RemediationSubStep(order=6, description="Re-run compliance evaluation and confirm the warning is resolved."),
        ]


def _finding_to_violation(f: ComplianceFinding) -> ViolationOut:
    """Map a backend ComplianceFinding to the frontend-friendly ViolationOut shape."""
    severity = f.severity if f.severity != "PASS" else "INFO"
    components = [c for c in [f.source, f.target] if c]

    explanation: str | None = None
    if f.remediation:
        parts = [f"{f.remediation.action.capitalize()} {f.remediation.component}"]
        if f.remediation.target_version:
            parts.append(f"to version {f.remediation.target_version}")
        parts.append(f"— {f.remediation.reason}")
        explanation = " ".join(parts)

    return ViolationOut(
        rule_id=f.rule_type,
        severity=severity,
        message=f.message,
        explanation=explanation,
        components=components if components else None,
    )


def _build_remediation_steps(report: DeviceComplianceReport) -> list[RemediationStepOut]:
    """Generate rich, step-by-step remediation plans from compliance findings."""
    steps: list[RemediationStepOut] = []
    seen: set[str] = set()

    # Severity priority order
    severity_order = {"CRITICAL": 0, "WARNING": 1, "INFO": 2, "PASS": 3}
    sorted_findings = sorted(
        [f for f in report.findings if f.remediation is not None],
        key=lambda f: (severity_order.get(f.severity, 99), f.source),
    )

    for i, f in enumerate(sorted_findings, start=1):
        rem = f.remediation
        if not rem:
            continue

        dedup_key = f"{rem.action}::{rem.component}"
        if dedup_key in seen:
            continue
        seen.add(dedup_key)

        time_map = {
            "upgrade": "15–30 min",
            "install": "10–20 min",
            "remove": "5–15 min",
            "remove or replace": "20–40 min",
            "avoid or replace": "20–40 min",
            "review": "30–60 min",
        }
        risk_map = {
            "CRITICAL": "CRITICAL",
            "WARNING": "WARNING",
            "INFO": None,
            "PASS": None,
        }

        sub_steps = _build_sub_steps(
            action=rem.action,
            component=rem.component,
            target_version=rem.target_version,
            reason=rem.reason,
            severity=f.severity,
        )

        steps.append(RemediationStepOut(
            order=i,
            action=f"{rem.action.capitalize()} {rem.component}"
                   + (f" to {rem.target_version}" if rem.target_version else ""),
            component=rem.component,
            target_version=rem.target_version,
            reason=rem.reason,
            estimated_time=time_map.get(rem.action.lower(), "15–30 min"),
            risk=risk_map.get(f.severity),
            sub_steps=sub_steps,
        ))

    return steps


def _specs_from_inventory(inventory_item: dict[str, Any] | None) -> list[DeviceSpecOut]:
    """Extract component specs from the raw inventory item."""
    if not inventory_item:
        return []
    specs: list[DeviceSpecOut] = []
    for comp in inventory_item.get("components", []):
        name = str(comp.get("name", "")).strip()
        version = str(comp.get("version", "")).strip()
        if name and version:
            specs.append(DeviceSpecOut(component=name, version=version, source="auto", confidence=1.0))
    return specs


def _report_to_device_out(
    report: DeviceComplianceReport,
    inventory_item: dict[str, Any] | None = None,
) -> DeviceEvaluationOut:
    violations = [_finding_to_violation(f) for f in report.findings]
    remediation = _build_remediation_steps(report)
    specs = _specs_from_inventory(inventory_item)

    return DeviceEvaluationOut(
        device_id=report.device_id,
        name=None,
        compliance_score=report.compliance_score,
        is_compliant=report.is_compliant,
        last_evaluated=None,
        violations=violations,
        remediation=remediation,
        specs=specs,
    )


def _reports_to_response(
    pairs: list[tuple[DeviceComplianceReport, dict[str, Any] | None]],
) -> EvaluationResponseOut:
    return EvaluationResponseOut(
        devices=[_report_to_device_out(r, inv) for r, inv in pairs]
    )


# ---------- Script Generation ----------

def _generate_powershell_script(report: DeviceComplianceReport, device_out: DeviceEvaluationOut) -> str:
    """Generate a PowerShell remediation script from a compliance report."""
    lines: list[str] = []
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    lines += [
        "#Requires -Version 5.1",
        "# ============================================================",
        f"#  ComplianceIQ — Remediation Script",
        f"#  Device  : {report.device_id}",
        f"#  Score   : {device_out.compliance_score}/100",
        f"#  Generated: {now}",
        "# ============================================================",
        "# WARNING: Review each step carefully before executing.",
        "# Run in an elevated PowerShell session (Run as Administrator).",
        "",
        'Write-Host "=== ComplianceIQ Remediation Script ===" -ForegroundColor Cyan',
        f'Write-Host "Device: {report.device_id}" -ForegroundColor White',
        f'Write-Host "Compliance Score: {device_out.compliance_score}/100" -ForegroundColor White',
        'Write-Host ""',
        "",
    ]

    for step in device_out.remediation:
        step_num = step.order if step.order is not None else "?"
        risk_color = "Red" if step.risk == "CRITICAL" else "Yellow" if step.risk == "WARNING" else "White"
        lines += [
            "# " + "─" * 60,
            f"# STEP {step_num}: {step.action}",
            f"# Risk: {step.risk or 'LOW'}  |  Est. Time: {step.estimated_time or 'N/A'}",
            "# " + "─" * 60,
            f'Write-Host ""',
            f'Write-Host "STEP {step_num}: {step.action}" -ForegroundColor {risk_color}',
        ]
        if step.reason:
            lines.append(f'Write-Host "  Reason: {step.reason}" -ForegroundColor DarkGray')
        if step.target_version:
            lines.append(f'Write-Host "  Target version: {step.target_version}" -ForegroundColor Cyan')

        if step.sub_steps:
            for sub in step.sub_steps:
                lines.append(f'Write-Host "  [{sub.order}] {sub.description}" -ForegroundColor Gray')
                if sub.warning:
                    lines += [
                        f'Write-Host "  ⚠ WARNING: {sub.warning}" -ForegroundColor Yellow',
                    ]
                if sub.note:
                    lines.append(f'Write-Host "  ℹ NOTE: {sub.note}" -ForegroundColor DarkCyan')
                if sub.command:
                    lines += [
                        "",
                        f"  # Command for sub-step {sub.order}:",
                        f"  {sub.command}",
                        "",
                    ]

        lines += ["", 'Write-Host "  ✓ Step complete. Press Enter to continue..." -ForegroundColor Green',
                  'Read-Host | Out-Null', ""]

    lines += [
        "",
        'Write-Host "=== All remediation steps completed ===" -ForegroundColor Green',
        'Write-Host "Re-run compliance evaluation to verify fixes." -ForegroundColor White',
    ]
    return "\r\n".join(lines)


def _generate_bash_script(report: DeviceComplianceReport, device_out: DeviceEvaluationOut) -> str:
    """Generate a Bash remediation script from a compliance report."""
    lines: list[str] = []
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    lines += [
        "#!/usr/bin/env bash",
        "# ============================================================",
        "#  ComplianceIQ — Remediation Script",
        f"#  Device  : {report.device_id}",
        f"#  Score   : {device_out.compliance_score}/100",
        f"#  Generated: {now}",
        "# ============================================================",
        "# WARNING: Review each step carefully before executing.",
        "# Run with sudo if required: sudo bash <script>",
        "",
        "set -euo pipefail",
        "",
        'echo "\\033[0;36m=== ComplianceIQ Remediation Script ===\\033[0m"',
        f'echo "Device: {report.device_id}"',
        f'echo "Compliance Score: {device_out.compliance_score}/100"',
        'echo ""',
        "",
    ]

    for step in device_out.remediation:
        step_num = step.order if step.order is not None else "?"
        color = "\\033[0;31m" if step.risk == "CRITICAL" else "\\033[0;33m" if step.risk == "WARNING" else "\\033[0;37m"
        lines += [
            "# " + "─" * 60,
            f"# STEP {step_num}: {step.action}",
            f"# Risk: {step.risk or 'LOW'}  |  Est. Time: {step.estimated_time or 'N/A'}",
            "# " + "─" * 60,
            'echo ""',
            f'echo "{color}STEP {step_num}: {step.action}\\033[0m"',
        ]
        if step.reason:
            lines.append(f'echo "  Reason: {step.reason}"')
        if step.target_version:
            lines.append(f'echo "  Target version: {step.target_version}"')

        if step.sub_steps:
            for sub in step.sub_steps:
                lines.append(f'echo "  [{sub.order}] {sub.description}"')
                if sub.warning:
                    lines.append(f'echo "  ⚠ WARNING: {sub.warning}"')
                if sub.note:
                    lines.append(f'echo "  ℹ NOTE: {sub.note}"')
                if sub.command:
                    lines += [
                        "",
                        f"  # Command for sub-step {sub.order}:",
                        f"  {sub.command}",
                        "",
                    ]

        lines += ["", 'read -p "  ✓ Step complete. Press Enter to continue..." _', ""]

    lines += [
        "",
        'echo "\\033[0;32m=== All remediation steps completed ===\\033[0m"',
        'echo "Re-run compliance evaluation to verify fixes."',
    ]
    return "\n".join(lines)


# ---------- Endpoints ----------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/system/status")
def system_status():
    """Return API and Neo4j connection status for the frontend System Status page."""
    neo4j_connected: bool = False
    try:
        with Neo4jClient() as db:
            db.verify_connection()
            neo4j_connected = True
    except Exception:
        neo4j_connected = False

    return {
        "status": "ok",
        "neo4j": {"connected": neo4j_connected},
        "cached_reports": count_reports(),
    }


@app.get("/devices/{device_id}/remediation-script")
def get_remediation_script(device_id: str, format: str = "powershell"):
    """
    Generate a downloadable remediation script for a device from the cached report.
    Query param: format = powershell (default) | bash
    Returns a plain-text file download.
    """
    from fastapi.responses import PlainTextResponse

    report = find_report(device_id)
    if not report:
        raise HTTPException(
            status_code=404,
            detail=f"No cached report found for device '{device_id}'. Run an evaluation first.",
        )

    # Build the DeviceEvaluationOut to reuse the rich remediation logic
    inv = get_inventory_for_device(report.device_id)
    device_out = _report_to_device_out(report, inv)

    fmt = format.lower().strip()
    if fmt in ("bash", "sh", "linux"):
        content = _generate_bash_script(report, device_out)
        filename = f"remediation_{report.device_id.replace(' ', '_')}.sh"
        media_type = "text/x-sh"
    else:
        content = _generate_powershell_script(report, device_out)
        filename = f"remediation_{report.device_id.replace(' ', '_')}.ps1"
        media_type = "text/plain"

    return PlainTextResponse(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/evaluate", response_model=EvaluationResponseOut)
def evaluate_from_files(
    rules_file: UploadFile = File(...),
    inventory_file: UploadFile = File(...),
):
    """
    Unified evaluation pipeline:
      1. Extract compliance rules from the uploaded rules file.
      2. Push extracted rules (nodes + relationships) to Neo4j so the
         knowledge graph stays in sync after every evaluation.
      3. Run inventory evaluation against the extracted graph.
      4. Cache results in-memory for /evaluate-inventory to serve.
      5. Return compliance reports as { devices: [...] }.

    Accepts: rules_file (.txt / .pdf), inventory_file (.json)
    """
    # Step 1 — parse rules
    rules_path = _save_upload_to_tempfile(rules_file)
    try:
        graph = extract_rules_from_file(str(rules_path))
    finally:
        rules_path.unlink(missing_ok=True)

    raw_inventory = _load_inventory_json_from_upload(inventory_file)
    vocab = {node.id for node in graph.nodes}
    inventory = InventoryNormalizer().normalize(raw_inventory, vocab)
    # Step 2 — push to Neo4j (keeps the knowledge graph up-to-date)
    try:
        with Neo4jClient() as db:
            db.verify_connection()
            db.clear_graph()
            db.push_graph(graph)
            db.save_metadata({
                "ruleset_name": rules_file.filename or "Unknown Ruleset",
                "uploaded_at": datetime.utcnow().isoformat() + "Z",
                "node_count": len(graph.nodes),
                "relationship_count": len(graph.relationships),
            })
    except Exception:
        # Non-fatal: evaluation can still proceed even if Neo4j is unavailable
        pass

    # Step 3 — evaluate inventory (reuse already-parsed + normalized inventory)
    clear_reports()
    reports = evaluate_inventory(graph, inventory)

    # Step 4 — cache results
    for report, inv_item in zip(reports, raw_inventory):
        register_report(report, inventory_item=inv_item)

    # Step 5 — return
    pairs = get_all_reports_with_inventory()

    return _reports_to_response(pairs)


@app.post("/evaluate-neo4j", response_model=EvaluationResponseOut)
def evaluate_neo4j_alias(
    rules_file: UploadFile = File(...),
    inventory_file: UploadFile = File(...),
):
    """
    Alias for POST /evaluate — kept for backwards compatibility.
    Both endpoints now execute the same unified pipeline (extract → Neo4j → evaluate).
    """
    return evaluate_from_files(rules_file=rules_file, inventory_file=inventory_file)


@app.post("/evaluate-json", response_model=EvaluationResponseOut)
def evaluate_from_json(payload: EvaluateRequest):
    """
    Evaluate from a pre-built graph + inventory object.
    Returns compliance reports wrapped as { devices: [...] }.
    """
    clear_reports()

    vocab = {node.id for node in payload.graph.nodes}
    inventory = InventoryNormalizer().normalize(payload.inventory, vocab)
    reports = evaluate_inventory(payload.graph, inventory)

    for report, inv_item in zip(reports, inventory):
        register_report(report, inventory_item=inv_item)

    pairs = get_all_reports_with_inventory()
    return _reports_to_response(pairs)






@app.post("/evaluate-inventory", response_model=EvaluationResponseOut)
def evaluate_inventory_cached_post():
    """
    Return cached compliance results. No re-evaluation is performed.
    Called by Fleet Overview on load (POST with no body).
    """
    pairs = get_all_reports_with_inventory()
    return _reports_to_response(pairs)


@app.get("/evaluate-inventory", response_model=EvaluationResponseOut)
def evaluate_inventory_cached():
    """
    Return the last-evaluated compliance results from the in-memory cache.
    No re-evaluation is performed. Used by the Fleet Overview page.
    """
    pairs = get_all_reports_with_inventory()
    return _reports_to_response(pairs)


@app.post("/ingest-rules", response_model=IngestRulesResponse)
def ingest_rules_only(rules_file: UploadFile = File(...)):
    """
    Extract rules from a file and store them in Neo4j.
    Returns the extracted rules in a frontend-friendly format.
    """
    rules_path = _save_upload_to_tempfile(rules_file)
    try:
        graph = extract_rules_from_file(str(rules_path))
    finally:
        rules_path.unlink(missing_ok=True)

    try:
        with Neo4jClient() as db:
            db.verify_connection()
            db.clear_graph()
            db.push_graph(graph)
            
            metadata = {
                "ruleset_name": rules_file.filename or "Unknown Ruleset",
                "uploaded_at": datetime.utcnow().isoformat() + "Z",
                "node_count": len(graph.nodes),
                "relationship_count": len(graph.relationships)
            }
            db.save_metadata(metadata)
            clear_vocabulary_cache()
            
            
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    # Build frontend-friendly rule list from the graph relationships
    rules_out: list[ExtractedRuleOut] = []
    node_map = {n.id: n for n in graph.nodes}
    for rel in graph.relationships:
        source_node = node_map.get(rel.source)
        target_node = node_map.get(rel.target)
        version_constraint: str | None = None
        if rel.min_version and rel.operator and rel.operator != "ANY":
            version_constraint = f"{rel.operator} {rel.min_version}"
        rules_out.append(
            ExtractedRuleOut(
                component_a=source_node.id if source_node else rel.source,
                component_b=target_node.id if target_node else rel.target,
                relationship=rel.type,
                version_constraint=version_constraint,
                severity=None,
                confidence=None,
            )
        )

    return IngestRulesResponse(
            message="Rules extracted and persisted to Neo4j successfully.",
            nodes=len(graph.nodes),
            relationships=len(graph.relationships),
            rules=rules_out,
        )






@app.get("/graph/full")
def get_full_graph():
    """Returns the latest graph stored in Neo4j."""
    try:
        with Neo4jClient() as db:
            db.verify_connection()
            return {"graph": db.get_full_graph()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/graph/network")
def get_graph_network():
    """
    Returns graph data in a frontend-friendly format:
    - nodes: all ComplianceEntity nodes
    - edges: all relationships between them
    """
    try:
        with Neo4jClient() as db:
            db.verify_connection()
            return db.get_graph_network()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/impact")
def get_impact(component: str | None = None, device_id: str | None = None):
    """
    Returns components affected when the given component/device changes.
    Accepts either ?component=X or ?device_id=X (both are treated the same way).
    Queries Neo4j for upstream (depends-on-this) and downstream (required-by-this)
    compliance entities and returns them as a flat list.
    """
    target = component or device_id
    if not target:
        raise HTTPException(status_code=422, detail="Provide either ?component=X or ?device_id=X")
    try:
        with Neo4jClient() as db:
            db.verify_connection()
            record = db.get_impact_analysis(target)

        # get_impact_analysis returns a single dict with keys:
        #   center_node, upstream_dependencies, downstream_dependencies
        # Each dependency list contains dicts like:
        #   { direction, component, component_type, relationship }
        # We flatten both lists into affected_components for the frontend.

        if not record:
            return {
                "component": target,
                "count": 0,
                "affected_components": [],
                "center_found": False,
            }

        upstream: list[dict] = record.get("upstream_dependencies") or []
        downstream: list[dict] = record.get("downstream_dependencies") or []

        # Filter out null/empty entries that Neo4j OPTIONAL MATCH may inject
        def _is_valid(dep: dict) -> bool:
            return bool(dep and dep.get("component"))

        upstream = [d for d in upstream if _is_valid(d)]
        downstream = [d for d in downstream if _is_valid(d)]

        affected: list[dict] = []
        for dep in upstream:
            affected.append({
                "id": dep.get("component"),
                "name": dep.get("component"),
                "type": dep.get("component_type") or "unknown",
                "direction": "DEPENDS_ON_THIS",
                "relationship": dep.get("relationship") or "",
            })
        for dep in downstream:
            affected.append({
                "id": dep.get("component"),
                "name": dep.get("component"),
                "type": dep.get("component_type") or "unknown",
                "direction": "REQUIRED_BY_THIS",
                "relationship": dep.get("relationship") or "",
            })

        return {
            "component": target,
            "count": len(affected),
            "center": record.get("center_node"),
            "affected_components": affected,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    try:
        result = ask_agent(
            question=request.question,
            session_id=request.session_id,
        )
        return ChatResponse(**result)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/debug/cache")
def debug_cache():
    return {
        "count": count_reports(),
        "device_ids": list_report_ids(),
    }


# ── Pydantic model for /simulate request ──────────────────────────────────────

class SimulateRequest(BaseModel):
    component: str = Field(description="Base component name or current version (e.g. 'BIOS', 'BIOS 1.6.2', 'Windows 11')")
    target_version: str = Field(default="", description="Target version to simulate upgrading to (e.g. '2.0.0', '24H2'). Leave empty to query the component as-is.")


@app.post("/simulate")
def simulate_change_endpoint(request: SimulateRequest):
    """
    What-If Simulator — dedicated REST endpoint.

    Simulates the impact of upgrading/changing a component to a target version.
    Queries the Neo4j knowledge graph for:
      - REQUIRES rules (what must also change)
      - CONFLICTS_WITH / WARNS_AGAINST rules (blockers / advisories)
      - COMPATIBLE_WITH / RECOMMENDS (positive signals)
    Then cross-references the in-memory device report cache to show which
    already-evaluated devices are affected and by how many critical/warning findings.

    Returns a structured result that the frontend renders as a rich visual diff.
    """
    from src.agent.tools.change_planning_tool import (
        _planned_component_id,
        _find_relevant_findings,
        _format_rule,
        _rule_priority,
    )

    component = request.component.strip()
    target_version = request.target_version.strip()
    planned_component = _planned_component_id(component, target_version)

    try:
        with Neo4jClient() as db:
            db.verify_connection()

            # Try planned version node first, fall back to base component
            context = db.get_component_context(planned_component)
            used_component = planned_component
            if context is None and planned_component != component:
                context = db.get_component_context(component)
                used_component = component

            if context is None:
                return {
                    "found": False,
                    "message": (
                        f"No graph node found for '{component}'"
                        + (f" (target version: {target_version})" if target_version else "")
                        + ". Make sure rules have been ingested first."
                    ),
                }

            outgoing_rules = list(context.get("outgoing_rules") or [])
            incoming_rules = list(context.get("incoming_rules") or [])

            direct_requirements: list[dict] = []
            blockers: list[dict] = []
            advisories: list[dict] = []
            involved_terms: set[str] = {component, planned_component, used_component}

            for rule in outgoing_rules:
                relationship = str(rule.get("relationship", "")).upper().strip()
                target = str(rule.get("target", "")).strip()
                operator = str(rule.get("operator", "ANY")).strip()
                min_version = rule.get("min_version")
                if target:
                    involved_terms.add(target)

                summary = {
                    "relationship": relationship,
                    "target": target,
                    "operator": operator,
                    "min_version": min_version,
                    "rule_text": _format_rule(rule),
                }
                if relationship == "REQUIRES":
                    direct_requirements.append(summary)
                elif relationship in {"CONFLICTS_WITH", "WARNS_AGAINST"}:
                    blockers.append(summary)
                else:
                    advisories.append(summary)

            for rule in incoming_rules:
                source = str(rule.get("source", "")).strip()
                if source:
                    involved_terms.add(source)

            direct_requirements.sort(key=lambda x: _rule_priority(str(x["relationship"])))
            blockers.sort(key=lambda x: _rule_priority(str(x["relationship"])))
            advisories.sort(key=lambda x: _rule_priority(str(x["relationship"])))

            affected_devices = _find_relevant_findings(involved_terms)

            blocker_count = len(blockers)
            requirement_count = len(direct_requirements)
            if blocker_count > 0:
                risk_level = "HIGH"
            elif requirement_count >= 3:
                risk_level = "MEDIUM"
            else:
                risk_level = "LOW"

            recommended_next_actions: list[str] = []
            for rule in blockers[:3]:
                recommended_next_actions.append(f"Resolve blocker: {rule['rule_text']}")
            for rule in direct_requirements[:3]:
                recommended_next_actions.append(f"Meet requirement: {rule['rule_text']}")
            for rule in advisories[:2]:
                recommended_next_actions.append(f"Review advisory: {rule['rule_text']}")

            return {
                "found": True,
                "change_request": {
                    "component": component,
                    "target_version": target_version,
                    "planned_component_id": planned_component,
                    "graph_node_used": used_component,
                },
                "risk_level": risk_level,
                "graph_context": {
                    "component_id": context.get("component_id"),
                    "component_type": context.get("component_type"),
                    "direct_requirements": direct_requirements,
                    "blockers": blockers,
                    "advisories": advisories,
                },
                "impact_summary": {
                    "devices_with_related_findings": len(affected_devices),
                    "critical_devices": sum(1 for d in affected_devices if d["critical_findings"] > 0),
                    "warning_devices": sum(1 for d in affected_devices if d["warning_findings"] > 0),
                },
                "affected_devices": affected_devices,
                "recommended_next_actions": recommended_next_actions,
            }

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# =============================================================================
# PRODUCT POLICY RELATIONSHIPS ENDPOINTS & HELPERS
# =============================================================================

class PolicyExtractedRuleOut(BaseModel):
    component_a: str
    component_b: str | None = None
    relationship: str
    version_constraint: str | None = None
    severity: str | None = None


class PolicyIngestResponse(BaseModel):
    message: str
    nodes: int
    relationships: int
    rules: list[PolicyExtractedRuleOut]


def _policy_finding_to_violation(f) -> ViolationOut:
    severity = f.severity if f.severity != "PASS" else "INFO"
    components = [f.source, f.target]
    explanation = f.remediation.reason if f.remediation else None
    return ViolationOut(
        rule_id=f.rule_type,
        severity=severity,
        message=f.message,
        explanation=explanation,
        components=components,
    )


def _policy_remediation_to_step(idx: int, f) -> RemediationStepOut:
    rem = f.remediation
    sub_steps = []
    action_type = rem.action.lower()

    if "enable" in action_type:
        sub_steps = [
            RemediationSubStep(order=1, description="Restart device and enter System BIOS settings (typically F2/F12)."),
            RemediationSubStep(order=2, description="Navigate to CPU configuration / Security Options."),
            RemediationSubStep(order=3, description="Enable Intel Virtualization Technology (VT-x) or AMD-V."),
            RemediationSubStep(order=4, description="Save changes, exit BIOS, and boot back into the OS."),
            RemediationSubStep(order=5, description="Open terminal and verify virtualization features are active.", command="systeminfo"),
        ]
    elif "install" in action_type:
        sub_steps = [
            RemediationSubStep(order=1, description=f"Download the latest installer package for {rem.component}."),
            RemediationSubStep(order=2, description="Run installer package matching the system architecture."),
            RemediationSubStep(order=3, description=f"Verify {rem.component} is active and properly added to user environment path."),
        ]
    elif "upgrade" in action_type:
        sub_steps = [
            RemediationSubStep(order=1, description=f"Check the current version of {rem.component}."),
            RemediationSubStep(order=2, description=f"Download and run the upgrade package for {rem.component} to target version {rem.target_version or 'latest'}."),
            RemediationSubStep(order=3, description="Restart dependent services to apply changes."),
        ]
    elif "remove" in action_type or "uninstall" in action_type:
        sub_steps = [
            RemediationSubStep(order=1, description=f"Open App Settings or configuration panel."),
            RemediationSubStep(order=2, description=f"Select and uninstall {rem.component} to satisfy system policy restrictions."),
        ]
    else:
        sub_steps = [
            RemediationSubStep(order=1, description=f"Review the policy specification for {rem.component}."),
            RemediationSubStep(order=2, description=f"Adjust system properties to align with requirements: {rem.reason}."),
        ]

    return RemediationStepOut(
        order=idx,
        action=f"{rem.action.capitalize()} {rem.component}" + (f" to {rem.target_version}" if rem.target_version else ""),
        component=rem.component,
        target_version=rem.target_version,
        reason=rem.reason,
        estimated_time="10–20 min",
        risk=f.severity if f.severity in ("CRITICAL", "WARNING") else None,
        sub_steps=sub_steps,
    )


def _policy_report_to_device_out(report: PolicyComplianceReport, inventory_item: dict[str, Any] | None = None) -> DeviceEvaluationOut:
    violations = [_policy_finding_to_violation(f) for f in report.findings]

    remediation = []
    seen = set()
    for idx, f in enumerate(report.findings, start=1):
        if not f.remediation:
            continue
        key = f"{f.remediation.action}::{f.remediation.component}"
        if key in seen:
            continue
        seen.add(key)
        remediation.append(_policy_remediation_to_step(len(remediation) + 1, f))

    specs = []
    if inventory_item:
        for comp in inventory_item.get("components", []):
            name = comp.get("name")
            version = comp.get("version")
            if name and version:
                specs.append(DeviceSpecOut(component=name, version=version, source="auto", confidence=1.0))

    return DeviceEvaluationOut(
        device_id=report.device_id,
        name=None,
        compliance_score=report.compliance_score,
        is_compliant=report.is_compliant,
        last_evaluated=None,
        violations=violations,
        remediation=remediation,
        specs=specs,
    )


def _policy_reports_to_response(
    pairs: list[tuple[PolicyComplianceReport, dict[str, Any] | None]],
    summary: str | None = None,
) -> PolicyEvaluationResponseOut:
    return PolicyEvaluationResponseOut(
        devices=[_policy_report_to_device_out(r, inv) for r, inv in pairs],
        policy_summary=summary,
    )


@app.post("/policy/evaluate", response_model=PolicyEvaluationResponseOut)
def evaluate_policy_from_files(
    rules_file: UploadFile = File(...),
    inventory_file: UploadFile = File(...),
):
    """
    Unified product policy evaluation pipeline.
    Uses RAG vector store to evaluate inventory against policy text.
    """
    rules_path = _save_upload_to_tempfile(rules_file)
    try:
        from src.ingestion.file_parsers import extract_and_chunk_rules_file
        chunks = extract_and_chunk_rules_file(str(rules_path))
        text = "\n\n".join(chunks)
        vectorstore = build_policy_vectorstore(text)
        set_global_policy_rag_store(vectorstore)
    finally:
        rules_path.unlink(missing_ok=True)

    inventory_path = _save_upload_to_tempfile(inventory_file)
    try:
        try:
            with open(inventory_path, "r", encoding="utf-8") as f:
                inventory_text = f.read()
        except UnicodeDecodeError:
            with open(inventory_path, "r", encoding="windows-1252", errors="replace") as f:
                inventory_text = f.read()
    finally:
        inventory_path.unlink(missing_ok=True)

    clear_policy_reports()
    
    # Process the text input to evaluate all devices
    fleet_report = evaluate_device_rag(inventory_text, vectorstore)

    from src.agent.policy_report_store import set_latest_policy_summary
    set_latest_policy_summary(fleet_report.summary)

    for report in fleet_report.devices:
        register_policy_report(report, inventory_item=None)

    pairs = get_all_policy_reports_with_inventory()
    return _policy_reports_to_response(pairs, fleet_report.summary)


@app.post("/policy/ingest-rules", response_model=PolicyIngestResponse)
def ingest_policy_rules_only(rules_file: UploadFile = File(...)):
    """Extract policy rules into a Vector Store."""
    rules_path = _save_upload_to_tempfile(rules_file)
    try:
        with open(rules_path, "r", encoding="utf-8") as f:
            text = f.read()
        vectorstore = build_policy_vectorstore(text)
        set_global_policy_rag_store(vectorstore)
    finally:
        rules_path.unlink(missing_ok=True)

    return PolicyIngestResponse(
        message="Policy document ingested into Vector Store successfully.",
        nodes=0,
        relationships=0,
        rules=[],
    )


@app.get("/policy/graph/network")
def get_policy_graph_network_endpoint():
    """Returns an empty graph since we now use vector RAG."""
    return {"nodes": [], "edges": []}


@app.get("/policy/evaluate-inventory", response_model=PolicyEvaluationResponseOut)
def evaluate_policy_inventory_cached():
    """Return the last-evaluated policy compliance reports from the in-memory cache."""
    pairs = get_all_policy_reports_with_inventory()
    from src.agent.policy_report_store import get_latest_policy_summary
    return _policy_reports_to_response(pairs, get_latest_policy_summary())


@app.post("/policy/evaluate-inventory", response_model=PolicyEvaluationResponseOut)
def evaluate_policy_inventory_cached_post():
    """Return the last-evaluated policy compliance reports (POST alias)."""
    pairs = get_all_policy_reports_with_inventory()
    from src.agent.policy_report_store import get_latest_policy_summary
    return _policy_reports_to_response(pairs, get_latest_policy_summary())



@app.get("/policy/inventory/mock")
def get_mock_policy_inventory_endpoint():
    """Load and return the mock policy inventory json directly."""
    mock_path = Path(__file__).resolve().parent.parent.parent / "data" / "inventory" / "mock_policy_devices.json"
    if not mock_path.exists():
        raise HTTPException(status_code=404, detail="Mock policy inventory file not found.")
    try:
        with open(mock_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

