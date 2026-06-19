from src.schemas import (
    DeviceComplianceReport,
    RootCauseAnalysis,
)


def analyze_root_cause(
    report: DeviceComplianceReport,
) -> RootCauseAnalysis:

    critical = [
        finding
        for finding in report.findings
        if finding.severity == "CRITICAL"
    ]

    warnings = [
        finding
        for finding in report.findings
        if finding.severity == "WARNING"
    ]

    root_causes = []
    recommended_actions = []

    for finding in critical:
        root_causes.append(finding.message)

        if finding.remediation:
            recommendation = (
                f"{finding.remediation.action} "
                f"{finding.remediation.component}"
            )

            if finding.remediation.target_version:
                recommendation += (
                    f" to {finding.remediation.target_version}"
                )

            recommended_actions.append(recommendation)

    return RootCauseAnalysis(
        device_id=report.device_id,
        is_compliant=report.is_compliant,
        compliance_score=report.compliance_score,
        critical_findings=critical,
        warning_findings=warnings,
        root_causes=root_causes,
        recommended_actions=recommended_actions,
    )