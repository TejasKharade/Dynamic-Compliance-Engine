from unittest.mock import patch

from src.core.compliance_evaluator import evaluate_device

from src.schemas import (
    ComplianceGraphDocument,
    DeviceComplianceReport,
    ComplianceNode,
)


@patch(
    "src.core.compliance_evaluator.build_compliance_workflow"
)
def test_compliant_device(mock_workflow):

    graph = ComplianceGraphDocument(
        nodes=[
            ComplianceNode(
                id="Windows 11",
                type="OperatingSystem",
            )
        ],
        relationships=[],
    )

    device = {
        "device_id": "LAT-001",
        "OperatingSystem": "Windows 11",
    }

    mock_report = DeviceComplianceReport(
        device_id="LAT-001",
        is_compliant=True,
        compliance_score=100,
        findings=[],
    )

    mock_workflow.return_value.invoke.return_value = {
        "report": mock_report
    }

    report = evaluate_device(graph, device)

    assert report.is_compliant is True
    assert report.compliance_score == 100
