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
def get_device_report(device_id: str) -> dict:
    """
    Retrieve the compliance report for a device.

    This accepts either:
    - the exact stored device id
    - the canonical id without labels
    - a partial device name

    Example:
      'PRECISION-TEST-002'
      'PRECISION-TEST-002 (Version Mismatch - Low Drivers)'
    """
    report = find_report(device_id)

    if report is None:
        return {
            "found": False,
            "query": device_id,
            "message": (
                f"No compliance report found for '{device_id}'. "
                f"Run evaluation first."
            ),
        }

    findings = sorted(
        report.findings,
        key=lambda f: SEVERITY_ORDER.get(f.severity, 99),
    )

    top_findings = [
        {
            "severity": f.severity,
            "rule_type": f.rule_type,
            "source": f.source,
            "target": f.target,
            "message": f.message,
        }
        for f in findings[:10]
    ]

    critical_count = sum(1 for f in report.findings if f.severity == "CRITICAL")
    warning_count = sum(1 for f in report.findings if f.severity == "WARNING")
    info_count = sum(1 for f in report.findings if f.severity == "INFO")

    return {
        "found": True,
        "query": device_id,
        "matched_device_id": report.device_id,
        "canonical_device_id": canonical_device_id(report.device_id),
        "is_compliant": report.is_compliant,
        "compliance_score": report.compliance_score,
        "finding_counts": {
            "critical": critical_count,
            "warning": warning_count,
            "info": info_count,
        },
        "top_findings": top_findings,
    }