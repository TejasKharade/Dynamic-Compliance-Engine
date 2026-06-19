from __future__ import annotations

import re
from typing import Any

from langchain_core.tools import tool

from src.agent.report_store import list_report_ids, find_report
from src.database.neo4j_client import Neo4jClient


def _version_key(value: str) -> tuple:
    tokens = re.findall(r"\d+|[A-Za-z]+", str(value).strip())
    key: list[tuple[int, Any]] = []

    for token in tokens:
        if token.isdigit():
            key.append((0, int(token)))
        else:
            key.append((1, token.lower()))

    return tuple(key)


def _compare_versions(installed: str, operator: str, required: str) -> bool:
    left = _version_key(installed)
    right = _version_key(required)

    if operator == "==":
        return left == right
    if operator == ">=":
        return left >= right
    if operator == "<":
        return left < right
    if operator == "ANY":
        return True
    return False


def _planned_component_id(component: str, target_version: str | None) -> str:
    component = component.strip()
    target_version = (target_version or "").strip()

    # If no target version was given, treat the component as the final target state.
    if not target_version:
        return component

    if component.startswith("BIOS ") or component.startswith("Windows "):
        parts = component.split()
        if len(parts) >= 2:
            return " ".join(parts[:-1] + [target_version])

    return component


def _format_rule(rule: dict[str, Any]) -> str:
    relationship = str(rule.get("relationship", "")).strip()
    target = str(rule.get("target") or rule.get("source") or "").strip()
    operator = str(rule.get("operator", "ANY")).strip()
    min_version = rule.get("min_version")

    if min_version and operator != "ANY":
        return f"{relationship} {target} {operator} {min_version}"
    if min_version:
        return f"{relationship} {target} {min_version}"
    return f"{relationship} {target}"


def _rule_priority(relationship: str) -> int:
    relationship = relationship.upper()
    if relationship in {"REQUIRES", "CONFLICTS_WITH"}:
        return 0
    if relationship == "WARNS_AGAINST":
        return 1
    if relationship == "COMPATIBLE_WITH":
        return 2
    if relationship == "RECOMMENDS":
        return 3
    return 4


def _find_relevant_findings(
    component_terms: set[str],
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []

    for device_id in list_report_ids():
        report = find_report(device_id)

        if report is None:
            continue
        relevant_findings = []
        critical_count = 0
        warning_count = 0

        for finding in report.findings:
            source = str(finding.source).strip()
            target = str(finding.target).strip()
            message = str(finding.message).strip()

            if (
                source in component_terms
                or target in component_terms
                or any(term in message for term in component_terms)
            ):
                relevant_findings.append(
                    {
                        "severity": finding.severity,
                        "rule_type": finding.rule_type,
                        "source": finding.source,
                        "target": finding.target,
                        "message": finding.message,
                        "remediation": (
                            finding.remediation.model_dump()
                            if finding.remediation
                            else None
                        ),
                    }
                )

                if finding.severity == "CRITICAL":
                    critical_count += 1
                elif finding.severity == "WARNING":
                    warning_count += 1

        if relevant_findings:
            results.append(
                {
                    "device_id": report.device_id,
                    "is_compliant": report.is_compliant,
                    "compliance_score": report.compliance_score,
                    "critical_findings": critical_count,
                    "warning_findings": warning_count,
                    "relevant_findings": relevant_findings,
                }
            )

    results.sort(
        key=lambda x: (
            -int(x["critical_findings"]),
            -int(x["warning_findings"]),
            int(x["compliance_score"]),
        )
    )
    return results


@tool
def simulate_change(component: str, target_version: str = "") -> dict:
    """
    Simulate the impact of changing a component to a target version.

    Use this when the user asks:
    - If I upgrade BIOS 1.6.2 to 2.0.0, what changes?
    - What will break if I move to Windows 11 24H2?
    - What devices are affected by this upgrade?
    - What should I upgrade first?
    """

    planned_component = _planned_component_id(component, target_version)

    try:
        with Neo4jClient() as db:
            db.verify_connection()

            # Try the planned version node first, then fall back to the original component.
            context = db.get_component_context(planned_component)
            used_component = planned_component

            if context is None and planned_component != component:
                context = db.get_component_context(component)
                used_component = component

            if context is None:
                return {
                    "found": False,
                    "message": (
                        f"No graph context found for '{component}' "
                        f"with target version '{target_version}'."
                    ),
                }

            outgoing_rules = list(context.get("outgoing_rules") or [])
            incoming_rules = list(context.get("incoming_rules") or [])

            direct_requirements = []
            blockers = []
            advisories = []
            involved_terms = {component, planned_component, used_component}

            for rule in outgoing_rules:
                relationship = str(rule.get("relationship", "")).upper().strip()
                target = str(rule.get("target", "")).strip()
                operator = str(rule.get("operator", "ANY")).strip()
                min_version = rule.get("min_version")

                involved_terms.add(target)

                summary = {
                    "relationship": relationship,
                    "target": target,
                    "operator": operator,
                    "min_version": min_version,
                    "rule_text": _format_rule(rule),
                }

                if relationship == "REQUIRES":
                    direct_requirements.append(summary)
                elif relationship in {"CONFLICTS_WITH", "WARNS_AGAINST"}:
                    blockers.append(summary)
                else:
                    advisories.append(summary)

            for rule in incoming_rules:
                source = str(rule.get("source", "")).strip()
                if source:
                    involved_terms.add(source)

            # Rank the direct change obligations
            direct_requirements.sort(
                key=lambda x: _rule_priority(str(x["relationship"]))
            )
            blockers.sort(key=lambda x: _rule_priority(str(x["relationship"])))
            advisories.sort(key=lambda x: _rule_priority(str(x["relationship"])))

            # Find already-evaluated devices that are relevant to this change
            affected_devices = _find_relevant_findings(involved_terms)

            # Turn the graph rules into a human-readable simulation summary
            blocker_count = len(blockers)
            requirement_count = len(direct_requirements)

            if blocker_count > 0:
                risk_level = "HIGH"
            elif requirement_count >= 3:
                risk_level = "MEDIUM"
            else:
                risk_level = "LOW"

            recommended_next_actions = []
            for rule in blockers[:3]:
                recommended_next_actions.append(
                    f"Resolve blocker: {rule['rule_text']}"
                )
            for rule in direct_requirements[:3]:
                recommended_next_actions.append(
                    f"Meet requirement: {rule['rule_text']}"
                )
            for rule in advisories[:2]:
                recommended_next_actions.append(
                    f"Review advisory: {rule['rule_text']}"
                )

            return {
                "found": True,
                "change_request": {
                    "component": component,
                    "target_version": target_version,
                    "planned_component_id": planned_component,
                    "graph_node_used": used_component,
                },
                "risk_level": risk_level,
                "graph_context": {
                    "component_id": context.get("component_id"),
                    "component_type": context.get("component_type"),
                    "direct_requirements": direct_requirements,
                    "blockers": blockers,
                    "advisories": advisories,
                },
                "impact_summary": {
                    "devices_with_related_findings": len(affected_devices),
                    "critical_devices": sum(
                        1 for d in affected_devices if d["critical_findings"] > 0
                    ),
                    "warning_devices": sum(
                        1 for d in affected_devices if d["warning_findings"] > 0
                    ),
                },
                "affected_devices": affected_devices[:10],
                "recommended_next_actions": recommended_next_actions,
            }

    except Exception as exc:
        return {
            "found": False,
            "error": str(exc),
        }