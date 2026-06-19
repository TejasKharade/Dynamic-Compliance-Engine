from unittest.mock import patch

from src.core.compliance_evaluator import evaluate_inventory

from src.schemas import (
    ComplianceGraphDocument,
    DeviceComplianceReport,
)


@patch(
    "src.core.compliance_evaluator.evaluate_device"
)
def test_inventory_evaluation(
    mock_evaluate_device,
):

    graph = ComplianceGraphDocument(
        nodes=[],
        relationships=[],
    )

    inventory = [
        {"device_id": "PC1"},
        {"device_id": "PC2"},
    ]

    mock_evaluate_device.side_effect = [
        DeviceComplianceReport(
            device_id="PC1",
            is_compliant=True,
            compliance_score=100,
            findings=[],
        ),
        DeviceComplianceReport(
            device_id="PC2",
            is_compliant=False,
            compliance_score=40,
            findings=[],
        ),
    ]

    reports = evaluate_inventory(
        graph,
        inventory,
    )

    assert len(reports) == 2

    assert reports[0].is_compliant
    assert not reports[1].is_compliant