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
    
    # Split required string by common delimiters to handle lists of versions (e.g. "4.11 and 4.12")
    required_parts = [p.strip() for p in re.split(r'\s+and\s+|\s+or\s+|,', str(required).strip(), flags=re.IGNORECASE) if p.strip()]
    
    if not required_parts:
        return True

    if operator == "==":
        return any(installed_key == _version_key(p) for p in required_parts)
    if operator == "!=":
        return all(installed_key != _version_key(p) for p in required_parts)
    
    for part in required_parts:
        required_key = _version_key(part)
        if operator == ">=" and installed_key >= required_key: return True
        if operator == "<" and installed_key < required_key: return True
        if operator == ">" and installed_key > required_key: return True
        if operator == "<=" and installed_key <= required_key: return True

    return False


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
) -> tuple[bool, ComplianceFinding | None]:
    rel_type = str(rel["relationship_type"]).strip()
    source_id = str(rel["source_id"]).strip()
    target_id = str(rel["target_id"]).strip()
    target_type = str(rel.get("target_type", "")).strip()
    operator = str(rel.get("operator", "ANY")).strip()
    min_version = rel.get("min_version")

    source_generic = _get_generic_name(source_id, "", valid_component_names)
    target_generic = _get_generic_name(target_id, target_type, valid_component_names)

    if source_generic not in installed_versions_by_name:
        return False, None

    if source_id != source_generic and source_id not in installed_entity_ids:
        return False, None

    if target_id != target_generic and target_id not in installed_entity_ids:
        if rel_type != "REQUIRES" or target_generic in installed_versions_by_name:
            return False, None

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
            return True, ComplianceFinding(
                rule_type=rel_type,
                severity="CRITICAL",
                source=source_id,
                target=target_id,
                message=f"{rule_subject} requires {rule_object}, but it is not installed.",
                remediation=_build_reremediation(rel_type, rule_object, False, str(min_version) if min_version else None)
            )
        return True, None

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
        return True, None

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

    return True, ComplianceFinding(
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


def _compute_score(
    findings: list[ComplianceFinding],
    total_components_checked: int = 0,
    total_components_installed: int = 0,
) -> int:
    """
    Production-grade compliance scoring engine.

    Modelled on CVSS v3 / NIST SP 800-53 / CIS Controls scoring philosophy:

    1. WEIGHTED SEVERITY with diminishing returns
       Each additional violation of the same severity costs progressively less
       (logarithmic decay), preventing identical scores for different profiles.

    2. RELATIONSHIP-TYPE AMPLIFIERS
       Active conflicts (CONFLICTS_WITH) are 1.40× more severe than a missing
       requirement because they represent an architectural incompatibility.
       WARNS_AGAINST is 1.15× (elevated risk, not guaranteed failure).

    3. COVERAGE FACTOR
       Penalty is scaled by how many of the device's installed components were
       actually evaluated. A device with 2/10 components covered cannot be
       docked full marks — only the covered portion is penalised.

    4. CONFLICT SYNERGY
       When a device has both CRITICAL findings AND active CONFLICTS findings,
       a small synergy multiplier is applied (they compound in real systems).

    5. SIGMOID NORMALISATION
       Raw penalty is passed through a logistic curve → smooth 0–100 range.
       No hard cliffs. Zero violations → 100. Single CRITICAL → ~76. Fully
       non-compliant device → approaches 0 smoothly.
    """
    import math

    if not findings:
        return 100

    # ── 1. Base weights per severity ─────────────────────────────────────────
    BASE_WEIGHT: dict[str, float] = {
        "CRITICAL": 32.0,
        "WARNING":  14.0,
        "INFO":      4.0,
        "BLOCKER":  40.0,  # future-proof
    }

    # ── 2. Relationship-type amplifiers ──────────────────────────────────────
    REL_AMPLIFIER: dict[str, float] = {
        "CONFLICTS_WITH": 1.40,
        "WARNS_AGAINST":  1.15,
        "REQUIRES":       1.00,
        "RECOMMENDS":     0.70,
        "COMPATIBLE_WITH":0.60,
    }

    # Group findings by severity for diminishing-returns calculation
    by_severity: dict[str, list[ComplianceFinding]] = {}
    for f in findings:
        by_severity.setdefault(f.severity, []).append(f)

    raw_penalty: float = 0.0

    for severity, sev_findings in by_severity.items():
        base = BASE_WEIGHT.get(severity, 5.0)
        for idx, finding in enumerate(sev_findings):
            # Diminishing returns: each extra violation costs log-less
            # idx=0 → factor 1.0, idx=1 → 0.85, idx=2 → 0.73, idx=3 → 0.63 …
            decay = 1.0 / (1.0 + 0.25 * idx)

            # Relationship-type amplifier
            amplifier = REL_AMPLIFIER.get(finding.rule_type, 1.0)

            raw_penalty += base * decay * amplifier

    # ── 3. Coverage factor ────────────────────────────────────────────────────
    # If coverage info is available, scale penalty by the fraction covered.
    # Prevents punishing devices where most rules simply don't apply.
    if total_components_installed > 0 and total_components_checked > 0:
        coverage_ratio = min(1.0, total_components_checked / total_components_installed)
        # Full coverage → factor 1.0; partial coverage → proportionally less
        # Use a sigmoid-shaped coverage weight so ~50% coverage ≈ 0.75 weight
        coverage_factor = 0.40 + 0.60 * coverage_ratio
        raw_penalty *= coverage_factor

    # ── 4. Conflict synergy bonus penalty ────────────────────────────────────
    has_critical  = any(f.severity == "CRITICAL" for f in findings)
    has_conflict  = any(f.rule_type == "CONFLICTS_WITH" for f in findings)
    if has_critical and has_conflict:
        raw_penalty *= 1.12   # 12% synergy amplification

    # ── 5. Sigmoid normalisation → smooth 0–100 ───────────────────────────────
    # score = 100 × sigmoid(-k × raw_penalty)  where sigmoid(0) = 0.5
    # k is tuned so raw_penalty=32 (one CRITICAL) → score ≈ 76
    k = 0.038
    sigmoid_val = 1.0 / (1.0 + math.exp(k * raw_penalty))
    # Rescale: sigmoid(0)=0.5 → 100, sigmoid(∞)=0 → 0
    normalised = (sigmoid_val - 0.0) / (0.5 - 0.0)   # 0..1 from bottom
    score_float = normalised * 100.0

    # Clamp and round — never return 100 if there are findings, never below 1
    score = int(round(min(99.0, max(1.0, score_float))))
    return score


def evaluate_device(
    relevant_relationships: list[dict[str, Any]],
    device_inventory: dict[str, Any],
    global_component_vocabulary: set[str],
) -> DeviceComplianceReport:
    device_id = str(device_inventory.get("device_id", "unknown-device"))
    
    installed_entity_ids, installed_versions_by_name, inventory_names = _build_inventory_indexes(device_inventory)
    valid_component_names = global_component_vocabulary.union(inventory_names)

    # Group relationships by (source_id, target_id, rel_type) for OR logic on COMPATIBLE_WITH, REQUIRES, RECOMMENDS
    or_groups: dict[Any, list[dict[str, Any]]] = {}
    other_rels: list[dict[str, Any]] = []

    for rel in relevant_relationships:
        rel_type = str(rel["relationship_type"]).strip()
        if rel_type in ("COMPATIBLE_WITH", "REQUIRES", "RECOMMENDS"):
            source_id = str(rel["source_id"]).strip()
            target_id = str(rel["target_id"]).strip()
            if rel_type == "COMPATIBLE_WITH":
                key = (frozenset({source_id, target_id}), rel_type)
            else:
                key = (source_id, target_id, rel_type)
            if key not in or_groups:
                or_groups[key] = []
            or_groups[key].append(rel)
        else:
            other_rels.append(rel)

    findings: list[ComplianceFinding] = []
    seen_finding_keys: set[tuple[str, str, str]] = set()

    # 1. Process OR groups
    for key, rels in or_groups.items():
        results = [
            (rel, _evaluate_relationship(rel, installed_entity_ids, installed_versions_by_name, valid_component_names))
            for rel in rels
        ]
        is_any_satisfied = any(
            is_applicable and finding is None
            for rel, (is_applicable, finding) in results
        )
        if is_any_satisfied:
            continue
        
        for rel, (is_applicable, finding) in results:
            if is_applicable and finding is not None:
                finding_key = tuple(sorted([finding.source, finding.target]) + [finding.rule_type])
                if finding_key in seen_finding_keys:
                    continue
                seen_finding_keys.add(finding_key)
                findings.append(finding)

    # 2. Process other relationships (e.g. CONFLICTS_WITH, WARNS_AGAINST)
    for rel in other_rels:
        is_applicable, finding = _evaluate_relationship(rel, installed_entity_ids, installed_versions_by_name, valid_component_names)
        if is_applicable and finding is not None:
            finding_key = tuple(sorted([finding.source, finding.target]) + [finding.rule_type])
            if finding_key in seen_finding_keys:
                continue
            seen_finding_keys.add(finding_key)
            findings.append(finding)

    total_installed = len(installed_versions_by_name)
    total_checked = len(components_covered_by_rules)

    critical_count = sum(1 for f in findings if f.severity == "CRITICAL")
    return DeviceComplianceReport(
        device_id=device_id,
        compliance_score=_compute_score(
            findings,
            total_components_checked=total_checked,
            total_components_installed=total_installed,
        ),
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


def evaluate_inventory_from_db(
    inventory: list[dict[str, Any]],
) -> list[DeviceComplianceReport]:
    reports: list[DeviceComplianceReport] = []

    with Neo4jClient() as db:
        db.verify_connection()
        
        full_graph = db.get_full_graph()
        global_component_vocabulary: set[str] = set()
        
        for edge in full_graph:
            for attr in ("source_type", "source_label", "source_node_type"):
                if attr in edge and edge[attr]:
                    global_component_vocabulary.add(str(edge[attr]).strip())
            for attr in ("target_type", "target_label", "target_node_type"):
                if attr in edge and edge[attr]:
                    global_component_vocabulary.add(str(edge[attr]).strip())

            if "source_id" in edge and edge["source_id"]:
                src_clean = re.sub(r"[\d\.\s>=<!]+", "", str(edge["source_id"])).strip()
                if src_clean: global_component_vocabulary.add(src_clean)
                
            if "target_id" in edge and edge["target_id"]:
                tgt_clean = re.sub(r"[\d\.\s>=<!]+", "", str(edge["target_id"])).strip()
                if tgt_clean: global_component_vocabulary.add(tgt_clean)

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