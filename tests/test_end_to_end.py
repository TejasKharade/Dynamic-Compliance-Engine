import json
from pathlib import Path

from src.ingestion.text_extractor import (
    extract_rules_from_file,
)
from src.core.compliance_evaluator import (
    evaluate_inventory,
)


def test_end_to_end():

    rules_file = (
        Path("data/rules/compatibility_v1.txt")
    )

    inventory_file = (
        Path("data/inventory/mock_devices.json")
    )

    graph = extract_rules_from_file(
        str(rules_file)
    )

    inventory = json.loads(
        inventory_file.read_text()
    )

    reports = evaluate_inventory(
        graph,
        inventory,
    )

    assert len(reports) > 0

    for report in reports:

        assert report.device_id
        assert 0 <= report.compliance_score <= 100