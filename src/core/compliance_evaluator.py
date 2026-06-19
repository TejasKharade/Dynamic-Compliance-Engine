from __future__ import annotations

import re
from typing import Any

from src.database.neo4j_client import Neo4jClient
from src.schemas import (
    ComplianceFinding,
    ComplianceGraphDocument,
    DeviceComplianceReport,
    RemediationRecommendation,
)


def _build_inventory_indexes(
    device_inventory: dict[str, Any],
) -> tuple[set[str], dict[str, str], set[str]]:
    installed_entity_ids: set[str] = set()
    installed_versions_by_name: dict[str, str] = {}
    inventory_component_names: set[str] = set()

    for component in device_inventory.get("components", []):
        name = str(component.get("name", "")).strip()
        version = str(component.get("version", "")).strip()

        if not name or not version:
            continue

        installed_versions_by_name[name] = version
        inventory_component_names.add(name)
        
        installed_entity_ids.add(name)
        installed_entity_ids.add(version)
        installed_entity_ids.add(f"{name} {version}")

    return installed_entity_ids, installed_versions_by_name, inventory_component_names


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
    installed_key = _version_key(installed)
    required_key = _version_key(required)

    if operator == "==": return installed_key == required_key
    if operator == ">=": return installed_key >= required_key
    if operator == "<":  return installed_key < required_key
    if operator == ">":  return installed_key > required_key
    if operator == "<=": return installed_key <= required_key
    if operator == "!=": return installed_key != required_key
    return True


def _get_generic_name(node_id: str, node_type: str, valid_component_names: set[str]) -> str:
    if node_id in valid_component_names:
        return node_id
    if node_type in valid_component_names:
        return node_type
    for generic in sorted(valid_component_names, key=len, reverse=True):
        if node_id.startswith(generic):
            return generic
    return node_id


def _build_reremediation(
    rel_type: str, target_component: str, target_present: bool, min_version: str | None
) -> RemediationRecommendation | None:
    actions = {
        "REQUIRES": "upgrade" if target_present else "install",
        "RECOMMENDS": "upgrade" if target_present else "install",
        "CONFLICTS_WITH": "remove or replace",
        "WARNS_AGAINST": "avoid or replace",
        "COMPATIBLE_WITH": "review"
    }
    reasons = {
        "REQUIRES": "Required to resolve a core system dependency validation failure.",
        "CONFLICTS_WITH": "Required to resolve an active architectural conflict declaration.",
        "WARNS_AGAINST": "Recommended to mitigate potential stability or performance warnings.",
        "RECOMMENDS": "Recommended upgrade track to align with structural support matrices.",
        "COMPATIBLE_WITH": "Manual configuration review recommended against current inventory context."
    }

    actual_target_version = None if rel_type in ("CONFLICTS_WITH", "WARNS_AGAINST") else min_version

    if rel_type in actions:
        return RemediationRecommendation(
            component=target_component,
            action=actions[rel_type],
            target_version=actual_target_version,
            reason=reasons[rel_type]
        )
    return None


def _evaluate_relationship(
    rel: dict[str, Any],
    installed_entity_ids: set[str],
    installed_versions_by_name: dict[str, str],
    valid_component_names: set[str],
) -> ComplianceFinding | None:
    rel_type = str(rel["relationship_type"]).strip()
    source_id = str(rel["source_id"]).strip()
    target_id = str(rel["target_id"]).strip()
    target_type = str(rel.get("target_type", "")).strip()
    operator = str(rel.get("operator", "ANY")).strip()
    min_version = rel.get("min_version")

    source_generic = _get_generic_name(source_id, "", valid_component_names)
    target_generic = _get_generic_name(target_id, target_type, valid_component_names)

    if source_generic not in installed_versions_by_name:
        return None

    if source_id != source_generic and source_id not in installed_entity_ids:
        return None

    if target_id != target_generic and target_id not in installed_entity_ids:
        if rel_type != "REQUIRES" or target_generic in installed_versions_by_name:
            return None

    target_for_version_check = target_generic
    is_inverted_constraint = False
    
    if min_version is not None:
        source_is_generic = source_id in valid_component_names
        target_is_generic = target_id in valid_component_names
        
        if source_is_generic and not target_is_generic:
            target_for_version_check = source_generic
            is_inverted_constraint = True

    if is_inverted_constraint:
        rule_subject = target_id
        rule_object = source_id
        remediation_component = source_id if source_id not in valid_component_names else source_generic
        installed_value = installed_versions_by_name.get(source_generic)
        component_missing = installed_value is None
    else:
        rule_subject = source_id
        rule_object = target_id
        remediation_component = target_id if target_id not in valid_component_names else target_generic
        installed_value = installed_versions_by_name.get(target_generic)
        component_missing = installed_value is None

    if component_missing:
        if rel_type == "REQUIRES":
            return ComplianceFinding(
                rule_type=rel_type,
                severity="CRITICAL",
                source=source_id,
                target=target_id,
                message=f"{rule_subject} requires {rule_object}, but it is not installed.",
                remediation=_build_reremediation(rel_type, rule_object, False, str(min_version) if min_version else None)
            )
        return None

    clean_operator = re.sub(r"[A-Za-z]+", "", operator).strip()
    if not clean_operator and ("ANY" in operator or operator == ""):
        version_matches = True
    elif min_version is not None:
        version_matches = _compare_versions(str(installed_value), clean_operator or "==", str(min_version))
    else:
        version_matches = True

    is_violation = False
    severity = "INFO"

    if rel_type == "REQUIRES":
        if not version_matches:
            is_violation = True
            severity = "CRITICAL"
    elif rel_type == "RECOMMENDS":
        if not version_matches:
            is_violation = True
            severity = "INFO"
    elif rel_type == "CONFLICTS_WITH":
        if version_matches:
            is_violation = True
            severity = "CRITICAL"
    elif rel_type == "WARNS_AGAINST":
        if version_matches:
            is_violation = True
            severity = "WARNING"
    elif rel_type == "COMPATIBLE_WITH":
        if not version_matches:
            is_violation = True
            severity = "WARNING"

    if not is_violation:
        return None

    if rel_type == "REQUIRES":
        msg = f"{rule_subject} requires {rule_object} {operator} {min_version}, but the installed value is {installed_value}." if min_version else f"{rule_subject} requires {rule_object}."
    elif rel_type == "CONFLICTS_WITH":
        msg = f"{rule_subject} conflicts with {rule_object} (Rule constraint: {operator} {min_version}, Machine value: {installed_value})." if min_version else f"{rule_subject} conflicts with {rule_object}."
    elif rel_type == "WARNS_AGAINST":
        msg = f"{rule_subject} warns against using {rule_object} (Rule constraint: {operator} {min_version}, Machine value: {installed_value})." if min_version else f"{rule_subject} warns against {rule_object}."
    elif rel_type == "RECOMMENDS":
        msg = f"{rule_subject} recommends {rule_object}, but structural recommendations are unmet."
    else:
        msg = f"{rule_subject} is not fully compatible with {rule_object} configuration paths."

    target_present = remediation_component in installed_versions_by_name

    return ComplianceFinding(
        rule_type=rel_type,
        severity=severity,
        source=source_id,
        target=target_id,
        message=msg,
        remediation=_build_reremediation(
            rel_type=rel_type,
            target_component=remediation_component,
            target_present=target_present,
            min_version=str(min_version) if min_version is not None else None,
        ),
    )


def _compute_score(findings: list[ComplianceFinding]) -> int:
    critical = sum(1 for f in findings if f.severity == "CRITICAL")
    warning = sum(1 for f in findings if f.severity == "WARNING")
    info = sum(1 for f in findings if f.severity == "INFO")
    return max(0, 100 - (critical * 30 + warning * 12 + info * 3))


def evaluate_device(
    relevant_relationships: list[dict[str, Any]],
    device_inventory: dict[str, Any],
    global_component_vocabulary: set[str],
) -> DeviceComplianceReport:
    device_id = str(device_inventory.get("device_id", "unknown-device"))
    
    installed_entity_ids, installed_versions_by_name, inventory_names = _build_inventory_indexes(device_inventory)
    valid_component_names = global_component_vocabulary.union(inventory_names)

    findings: list[ComplianceFinding] = []
    seen_finding_keys: set[tuple[str, str, str]] = set()

    for rel in relevant_relationships:
        finding = _evaluate_relationship(rel, installed_entity_ids, installed_versions_by_name, valid_component_names)
        if finding is not None:
            finding_key = tuple(sorted([finding.source, finding.target]) + [finding.rule_type])
            if finding_key in seen_finding_keys:
                continue
            seen_finding_keys.add(finding_key)
            findings.append(finding)

    critical_count = sum(1 for f in findings if f.severity == "CRITICAL")
    return DeviceComplianceReport(
        device_id=device_id,
        compliance_score=_compute_score(findings),
        is_compliant=(critical_count == 0),
        findings=findings,
    )


def evaluate_inventory(
    graph: ComplianceGraphDocument,
    inventory: list[dict[str, Any]],
) -> list[DeviceComplianceReport]:
    reports: list[DeviceComplianceReport] = []

    global_component_vocabulary: set[str] = set()
    for edge in graph.relationships:
        for attr in ("source_type", "source_label", "source_node_type"):
            if hasattr(edge, attr) and getattr(edge, attr):
                global_component_vocabulary.add(str(getattr(edge, attr)).strip())
        for attr in ("target_type", "target_label", "target_node_type"):
            if hasattr(edge, attr) and getattr(edge, attr):
                global_component_vocabulary.add(str(getattr(edge, attr)).strip())

        if hasattr(edge, "source_id") and edge.source_id:
            src_clean = re.sub(r"[\d\.\s>=<!]+", "", str(edge.source_id)).strip()
            if src_clean: global_component_vocabulary.add(src_clean)
            
        if hasattr(edge, "target_id") and edge.target_id:
            tgt_clean = re.sub(r"[\d\.\s>=<!]+", "", str(edge.target_id)).strip()
            if tgt_clean: global_component_vocabulary.add(tgt_clean)

    with Neo4jClient() as db:
        db.verify_connection()
        db.clear_graph()
        db.push_graph(graph)

        all_unique_installed_entities: set[str] = set()
        device_cached_indexes: list[tuple[dict[str, Any], set[str]]] = []
        
        for device in inventory:
            entity_ids, _, _ = _build_inventory_indexes(device)
            all_unique_installed_entities.update(entity_ids)
            device_cached_indexes.append((device, entity_ids))

        master_relationship_pool = db.get_relevant_relationships(sorted(all_unique_installed_entities))

        for device, entity_ids in device_cached_indexes:
            local_relationships = [
                rel for rel in master_relationship_pool
                if str(rel["source_id"]).strip() in entity_ids or str(rel["target_id"]).strip() in entity_ids
            ]
            reports.append(evaluate_device(local_relationships, device, global_component_vocabulary))

    return reports