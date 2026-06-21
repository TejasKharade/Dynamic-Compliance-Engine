import argparse
import json
from pathlib import Path

from src.agent.report_store import register_report
from src.core.compliance_evaluator import evaluate_inventory
from src.schemas import ComplianceGraphDocument

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_INVENTORY_PATH = BASE_DIR / "data" / "inventory" / "mock_devices.json"
DEFAULT_RULES_PATH = BASE_DIR / "data" / "rules" / "compatibility_v1.txt"


def load_inventory(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_graph_from_rules(path: Path) -> ComplianceGraphDocument:
    from src.ingestion.text_extractor import extract_rules_from_file
    return extract_rules_from_file(str(path))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate endpoint inventory with LLM-extracted compatibility rules."
    )
    parser.add_argument(
        "--inventory",
        type=Path,
        default=DEFAULT_INVENTORY_PATH,
        help="Path to the device inventory JSON file.",
    )
    parser.add_argument(
        "--rules",
        type=Path,
        default=DEFAULT_RULES_PATH,
        help="Path to the compatibility rules text or PDF file.",
    )
    parser.add_argument(
        "--use-extracted-rules",
        action="store_true",
        help="Extract rules with the LLM before compliance evaluation.",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        help="Optional path where compliance reports should be saved as JSON.",
    )
    return parser.parse_args()


def print_report_summary(reports) -> None:
    for report in reports:
        status = "COMPLIANT" if report.is_compliant else "NON-COMPLIANT"
        print(f"\n{report.device_id}: {status} ({report.compliance_score}/100)")

        if not report.findings:
            print("  No findings.")
            continue

        for finding in report.findings:
            print(f"  [{finding.severity}] {finding.message}")
            if finding.remediation:
                remediation = finding.remediation
                target = f" to {remediation.target_version}" if remediation.target_version else ""
                print(f"    Remediation: {remediation.action} {remediation.component}{target}")


def save_reports_json(reports, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    report_data = [report.model_dump() for report in reports]
    path.write_text(json.dumps(report_data, indent=2), encoding="utf-8")


def main() -> None:
    args = parse_args()

    graph = load_graph_from_rules(args.rules)
    inventory = load_inventory(args.inventory)
    reports = evaluate_inventory(graph, inventory)

    for r in reports:
        register_report(r)
    print_report_summary(reports)

    if args.output_json:
        save_reports_json(reports, args.output_json)
        print(f"\nSaved JSON report to: {args.output_json}")


if __name__ == "__main__":
    main()