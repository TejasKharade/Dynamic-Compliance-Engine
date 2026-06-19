from __future__ import annotations

import re
from typing import Optional

from src.schemas import DeviceComplianceReport

_REPORTS_BY_RAW_ID: dict[str, DeviceComplianceReport] = {}
_REPORTS_BY_CANONICAL_ID: dict[str, DeviceComplianceReport] = {}


def canonical_device_id(value: str) -> str:
    """
    Remove trailing descriptive labels like:
      'PRECISION-TEST-002 (Version Mismatch - Low Drivers)'
    -> 'PRECISION-TEST-002'
    """
    value = value.strip()
    value = re.sub(r"\s*\([^)]*\)\s*$", "", value).strip()
    return value


def normalize_text(value: str) -> str:
    """
    Normalize text for fuzzy matching.
    """
    value = canonical_device_id(value)
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def clear_reports() -> None:
    _REPORTS_BY_RAW_ID.clear()
    _REPORTS_BY_CANONICAL_ID.clear()


def register_report(report: DeviceComplianceReport) -> None:
    """
    Register a report using both the full display id and the canonical id.
    """
    raw_id = report.device_id.strip()
    canonical_id = canonical_device_id(raw_id)

    _REPORTS_BY_RAW_ID[raw_id] = report
    _REPORTS_BY_CANONICAL_ID[canonical_id] = report


def find_report(query: str) -> Optional[DeviceComplianceReport]:
    """
    Resolve a user query to a report using:
    1. exact raw id
    2. exact canonical id
    3. normalized exact / partial / token-overlap matching
    """
    if not query:
        return None

    q_raw = query.strip()

    # Exact raw match
    if q_raw in _REPORTS_BY_RAW_ID:
        return _REPORTS_BY_RAW_ID[q_raw]

    # Exact canonical match
    q_canonical = canonical_device_id(q_raw)
    if q_canonical in _REPORTS_BY_CANONICAL_ID:
        return _REPORTS_BY_CANONICAL_ID[q_canonical]

    q_norm = normalize_text(q_raw)
    q_tokens = set(q_norm.split())

    exact_norm_matches: list[DeviceComplianceReport] = []
    substring_matches: list[DeviceComplianceReport] = []
    scored_matches: list[tuple[int, DeviceComplianceReport]] = []

    for raw_id, report in _REPORTS_BY_RAW_ID.items():
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


def list_report_ids() -> list[str]:
    return list(_REPORTS_BY_RAW_ID.keys())


def count_reports() -> int:
    return len(_REPORTS_BY_RAW_ID)