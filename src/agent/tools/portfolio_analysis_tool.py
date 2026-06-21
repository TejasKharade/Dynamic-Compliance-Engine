from collections import Counter
from langchain_core.tools import tool

from src.agent.report_store import list_report_ids, find_report

SEVERITY_WEIGHT = {
    "CRITICAL": 10,
    "WARNING": 3,
    "INFO": 1,
    "PASS": 0,
}


@tool
def portfolio_risk_analysis() -> dict:
    """
    Analyze the entire compliance portfolio.

    Use when user asks:
    - Which devices are highest risk?
    - What should I fix first?
    - Fleet summary
    - Most common compliance issues
    - Overall compliance posture
    """

    reports = []

    for device_id in list_report_ids():
        report = find_report(device_id)
        if report:
            reports.append(report)

    # Fallback/merge policy compliance reports
    from src.agent.policy_report_store import list_policy_report_ids, find_policy_report
    for device_id in list_policy_report_ids():
        report = find_policy_report(device_id)
        if report:
            reports.append(report)

    if not reports:
        return {
            "found": False,
            "message": "No compliance reports available."
        }

    device_rankings = []
    component_failures = Counter()
    rule_failures = Counter()

    compliant_count = 0
    non_compliant_count = 0

    for report in reports:

        if report.is_compliant:
            compliant_count += 1
        else:
            non_compliant_count += 1

        risk_score = 0

        for finding in report.findings:

            risk_score += SEVERITY_WEIGHT.get(
                finding.severity,
                0,
            )

            if finding.severity in {"CRITICAL", "WARNING"}:

                component_failures[finding.target] += 1
                rule_failures[finding.rule_type] += 1

        device_rankings.append(
            {
                "device_id": report.device_id,
                "compliance_score": report.compliance_score,
                "risk_score": risk_score,
                "is_compliant": report.is_compliant,
            }
        )

    device_rankings.sort(
        key=lambda x: (
            -x["risk_score"],
            x["compliance_score"],
        )
    )

    top_components = [
        {
            "component": component,
            "failure_count": count,
        }
        for component, count in component_failures.most_common(10)
    ]

    top_rule_types = [
        {
            "rule_type": rule_type,
            "count": count,
        }
        for rule_type, count in rule_failures.most_common()
    ]

    return {
        "found": True,
        "portfolio_summary": {
            "total_devices": len(reports),
            "compliant_devices": compliant_count,
            "non_compliant_devices": non_compliant_count,
            "compliance_rate": round(
                compliant_count / len(reports) * 100,
                2,
            ),
        },
        "highest_risk_devices": device_rankings[:10],
        "most_problematic_components": top_components,
        "most_common_rule_violations": top_rule_types,
        "recommended_priority": (
            top_components[0]["component"]
            if top_components
            else None
        ),
    }