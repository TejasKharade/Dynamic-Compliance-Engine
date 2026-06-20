from __future__ import annotations

import json
import shutil
import tempfile
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
from src.agent.report_store import (
    clear_reports,
    register_report,
    list_report_ids,
    count_reports,
    get_all_reports,
    get_all_reports_with_inventory,
    get_inventory_for_device,
)


app = FastAPI(
    title="Dynamic Compatibility & Configuration Compliance Engine",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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


@app.post("/evaluate", response_model=EvaluationResponseOut)
def evaluate_from_files(
    rules_file: UploadFile = File(...),
    inventory_file: UploadFile = File(...),
):
    """
    Upload a rules file (.txt or .pdf) and inventory file (.json).
    Returns compliance reports wrapped as { devices: [...] }.
    """
    rules_path = _save_upload_to_tempfile(rules_file)
    try:
        graph = extract_rules_from_file(str(rules_path))
    finally:
        rules_path.unlink(missing_ok=True)

    inventory = _load_inventory_json_from_upload(inventory_file)
    clear_reports()

    reports = evaluate_inventory(graph, inventory)

    for report, inv_item in zip(reports, inventory):
        register_report(report, inventory_item=inv_item)

    pairs = get_all_reports_with_inventory()
    return _reports_to_response(pairs)


@app.post("/evaluate-json", response_model=EvaluationResponseOut)
def evaluate_from_json(payload: EvaluateRequest):
    """
    Evaluate from a pre-built graph + inventory object.
    Returns compliance reports wrapped as { devices: [...] }.
    """
    clear_reports()

    reports = evaluate_inventory(payload.graph, payload.inventory)

    for report, inv_item in zip(reports, payload.inventory):
        register_report(report, inventory_item=inv_item)

    pairs = get_all_reports_with_inventory()
    return _reports_to_response(pairs)


@app.post("/evaluate-neo4j", response_model=EvaluationResponseOut)
def evaluate_from_rules_and_inventory_files(
    rules_file: UploadFile = File(...),
    inventory_file: UploadFile = File(...),
):
    """
    Same as /evaluate but explicitly exposes the Neo4j-backed path.
    """
    rules_path = _save_upload_to_tempfile(rules_file)
    try:
        graph = extract_rules_from_file(str(rules_path))
    finally:
        rules_path.unlink(missing_ok=True)

    inventory = _load_inventory_json_from_upload(inventory_file)
    clear_reports()

    reports = evaluate_inventory(graph, inventory)

    for report, inv_item in zip(reports, inventory):
        register_report(report, inventory_item=inv_item)

    pairs = get_all_reports_with_inventory()
    return _reports_to_response(pairs)


@app.post("/evaluate-inventory", response_model=EvaluationResponseOut)
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