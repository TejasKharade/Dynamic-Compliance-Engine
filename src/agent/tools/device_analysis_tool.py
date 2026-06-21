from __future__ import annotations

from langchain_core.tools import tool

from src.agent.report_store import canonical_device_id, find_report


SEVERITY_ORDER = {
    "CRITICAL": 0,
    "WARNING": 1,
    "INFO": 2,
    "PASS": 3,
}


@tool
def analyze_device(device_id: str) -> dict:
    """
    Deep analysis for a device.

    Use this when the user asks:
    - why a device is failing
    - what the root cause is
    - what to fix first
    - what remediation is recommended

    The device_id may be exact, canonical, or partial.
    """
    report = find_report(device_id)

    if report is None:
        from src.agent.policy_report_store import find_policy_report
        report = find_policy_report(device_id)

    if report is None:
        return {
            "found": False,
            "query": device_id,
            "message": f"No report found for '{device_id}'.",
        }

    sorted_findings = sorted(
        report.findings,
        key=lambda f: SEVERITY_ORDER.get(f.severity, 99),
    )

    critical_findings = [
        {
            "severity": f.severity,
            "rule_type": f.rule_type,
            "source": f.source,
            "target": f.target,
            "message": f.message,
            "remediation": (
                f.remediation.model_dump() if f.remediation else None
            ),
        }
        for f in sorted_findings
        if f.severity == "CRITICAL"
    ]

    warning_findings = [
        {
            "severity": f.severity,
            "rule_type": f.rule_type,
            "source": f.source,
            "target": f.target,
            "message": f.message,
            "remediation": (
                f.remediation.model_dump() if f.remediation else None
            ),
        }
        for f in sorted_findings
        if f.severity == "WARNING"
    ]

    root_causes = [
        item["message"] for item in critical_findings
    ]

    remediation_order = []
    for idx, item in enumerate(critical_findings, start=1):
        remediation = item["remediation"]
        if remediation:
            remediation_order.append(
                {
                    "priority": idx,
                    "component": remediation.get("component"),
                    "action": remediation.get("action"),
                    "target_version": remediation.get("target_version"),
                    "reason": remediation.get("reason"),
                }
            )

    if not remediation_order:
        for idx, item in enumerate(warning_findings, start=1):
            remediation = item["remediation"]
            if remediation:
                remediation_order.append(
                    {
                        "priority": idx,
                        "component": remediation.get("component"),
                        "action": remediation.get("action"),
                        "target_version": remediation.get("target_version"),
                        "reason": remediation.get("reason"),
                    }
                )

    executive_summary = (
        f"{report.device_id} is "
        f"{'compliant' if report.is_compliant else 'non-compliant'} "
        f"with score {report.compliance_score}/100."
    )

    return {
        "found": True,
        "query": device_id,
        "matched_device_id": report.device_id,
        "canonical_device_id": canonical_device_id(report.device_id),
        "is_compliant": report.is_compliant,
        "compliance_score": report.compliance_score,
        "critical_count": len(critical_findings),
        "warning_count": len(warning_findings),
        "root_causes": root_causes,
        "critical_findings": critical_findings,
        "warning_findings": warning_findings,
        "recommended_remediation_order": remediation_order,
        "executive_summary": executive_summary,
    }