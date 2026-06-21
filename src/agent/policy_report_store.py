from typing import Any
from src.policy_schemas import PolicyComplianceReport

_POLICY_REPORTS: dict[str, PolicyComplianceReport] = {}
_POLICY_INVENTORY: dict[str, dict[str, Any]] = {}


def clear_policy_reports() -> None:
    _POLICY_REPORTS.clear()
    _POLICY_INVENTORY.clear()


def register_policy_report(report: PolicyComplianceReport, inventory_item: dict[str, Any] | None = None) -> None:
    raw_id = report.device_id.strip()
    _POLICY_REPORTS[raw_id] = report
    if inventory_item is not None:
        _POLICY_INVENTORY[raw_id] = inventory_item


def get_policy_inventory_for_device(device_id: str) -> dict[str, Any] | None:
    return _POLICY_INVENTORY.get(device_id.strip())


def find_policy_report(query: str) -> PolicyComplianceReport | None:
    """
    Resolve a user query to a policy report using:
    1. exact raw id
    2. exact canonical id
    3. normalized exact / partial / token-overlap matching
    """
    if not query:
        return None

    q_raw = query.strip()

    # Exact raw match
    if q_raw in _POLICY_REPORTS:
        return _POLICY_REPORTS[q_raw]

    # Exact canonical match
    from src.agent.report_store import canonical_device_id, normalize_text
    q_canonical = canonical_device_id(q_raw)
    for raw_id, report in _POLICY_REPORTS.items():
        if canonical_device_id(raw_id) == q_canonical:
            return report

    q_norm = normalize_text(q_raw)
    q_tokens = set(q_norm.split())

    exact_norm_matches = []
    substring_matches = []
    scored_matches = []

    for raw_id, report in _POLICY_REPORTS.items():
        raw_norm = normalize_text(raw_id)
        canonical_norm = normalize_text(canonical_device_id(raw_id))
        raw_tokens = set(raw_norm.split())

        if q_norm == raw_norm or q_norm == canonical_norm:
            exact_norm_matches.append(report)
            continue

        if (
            q_norm in raw_norm
            or raw_norm in q_norm
            or q_norm in canonical_norm
            or canonical_norm in q_norm
        ):
            substring_matches.append(report)
            continue

        overlap = len(q_tokens & raw_tokens)
        if overlap > 0:
            scored_matches.append((overlap, report))

    if len(exact_norm_matches) == 1:
        return exact_norm_matches[0]

    if len(substring_matches) == 1:
        return substring_matches[0]

    if scored_matches:
        scored_matches.sort(key=lambda item: (-item[0], len(item[1].device_id)))
        if len(scored_matches) == 1 or scored_matches[0][0] > scored_matches[1][0]:
            return scored_matches[0][1]

    return None


def list_policy_report_ids() -> list[str]:
    return list(_POLICY_REPORTS.keys())


def count_policy_reports() -> int:
    return len(_POLICY_REPORTS)


def get_all_policy_reports() -> list[PolicyComplianceReport]:
    return list(_POLICY_REPORTS.values())


def get_all_policy_reports_with_inventory() -> list[tuple[PolicyComplianceReport, dict[str, Any] | None]]:
    return [
        (report, _POLICY_INVENTORY.get(raw_id))
        for raw_id, report in _POLICY_REPORTS.items()
    ]


_LATEST_POLICY_SUMMARY: str = ""


def set_latest_policy_summary(summary: str) -> None:
    global _LATEST_POLICY_SUMMARY
    _LATEST_POLICY_SUMMARY = summary


def get_latest_policy_summary() -> str:
    return _LATEST_POLICY_SUMMARY

