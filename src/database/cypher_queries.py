# =============================================================================
# CYPHER QUERIES
# =============================================================================
# All raw Cypher query strings used by the Neo4jClient.
# Using .format(type=..., rel_type=...) for dynamic labels/relationship types
# because Neo4j does not allow label names or relationship types as parameters.
# The values are always validated by our Pydantic schema, so this is safe.
# =============================================================================

# -----------------------------------------------------------------------------
# MERGE a node into the graph.
# - Uses MERGE on the `id` property so the same entity is never duplicated.
# - SET n.type stores the category as a property (e.g. "BIOS", "Driver").
# - SET n:{type} also adds a native Neo4j label (e.g. :BIOS, :Driver)
#   so you can query MATCH (n:BIOS) in the Neo4j Browser.
# -----------------------------------------------------------------------------
MERGE_NODE_QUERY = """
MERGE (n:ComplianceEntity {{id: $id}})
SET n.type = $type
SET n:{type}
RETURN n
"""

# -----------------------------------------------------------------------------
# CREATE a relationship between two existing nodes, avoiding exact duplicates.
# - Looks up source and target nodes by their `id` property.
# - Uses a conditional CREATE so that each unique combination of
#   (source, target, rel_type, operator, min_version) produces its own edge.
#   This prevents multi-version rules (e.g. "compatible with 4.11 and 4.12")
#   from being collapsed into a single relationship.
# -----------------------------------------------------------------------------
MERGE_RELATIONSHIP_QUERY = """
MATCH (source:ComplianceEntity {{id: $source_id}})
MATCH (target:ComplianceEntity {{id: $target_id}})
WHERE NOT EXISTS {{
    MATCH (source)-[existing:{rel_type}]->(target)
    WHERE existing.operator = $operator
      AND existing.min_version = $min_version
}}
CREATE (source)-[r:{rel_type}]->(target)
SET r.operator = $operator,
    r.min_version = $min_version
RETURN r
"""

# -----------------------------------------------------------------------------
# Wipe the entire graph — useful before a fresh re-ingestion run.
# DETACH DELETE removes all nodes AND all their relationships.
# -----------------------------------------------------------------------------
CLEAR_GRAPH_QUERY = """
MATCH (n:ComplianceEntity) DETACH DELETE n
"""

# -----------------------------------------------------------------------------
# Retrieve the full graph for visualization or export.
# Returns every node and every relationship in the database.
# -----------------------------------------------------------------------------
GET_FULL_GRAPH_QUERY = """
MATCH (source:ComplianceEntity)-[r]->(target:ComplianceEntity)
RETURN source.id AS source_id,
       source.type AS source_type,
       type(r) AS relationship_type,
       r.operator AS operator,
       r.min_version AS min_version,
       target.id AS target_id,
       target.type AS target_type
"""

# -----------------------------------------------------------------------------
# Store and retrieve RulesetMetadata
# -----------------------------------------------------------------------------
MERGE_METADATA_QUERY = """
MERGE (m:RulesetMetadata {id: "singleton"})
SET m += $metadata
RETURN m
"""

GET_METADATA_QUERY = """
MATCH (m:RulesetMetadata {id: "singleton"})
RETURN m
"""

# ---------------------------------------------------------------------
# Fetch only the relationships that are relevant to a given inventory.
# A relationship is relevant if either its source or target entity matches
# an entity identifier present in the aggregated inventory batch.
# ---------------------------------------------------------------------
GET_RELEVANT_RELATIONSHIPS_QUERY = """
MATCH (source:ComplianceEntity)-[r]->(target:ComplianceEntity)
WHERE source.id IN $entity_ids OR target.id IN $entity_ids
RETURN DISTINCT
       source.id AS source_id,
       source.type AS source_type,
       type(r) AS relationship_type,
       r.operator AS operator,
       r.min_version AS min_version,
       target.id AS target_id,
       target.type AS target_type
"""

GET_ALL_NODES_QUERY = """
MATCH (n:ComplianceEntity)
RETURN DISTINCT
       n.id AS id,
       n.type AS type
ORDER BY type, id
"""

GET_ALL_RELATIONSHIPS_QUERY = """
MATCH (source:ComplianceEntity)-[r]->(target:ComplianceEntity)
RETURN DISTINCT
       source.id AS source_id,
       source.type AS source_type,
       type(r) AS relationship_type,
       r.operator AS operator,
       r.min_version AS min_version,
       target.id AS target_id,
       target.type AS target_type
ORDER BY source_id, relationship_type, target_id
"""

GET_IMPACT_ANALYSIS_QUERY = """
MATCH (center:ComplianceEntity {id: $node_id})

OPTIONAL MATCH (upstream:ComplianceEntity)-[r1]->(center)

OPTIONAL MATCH (center)-[r2]->(downstream:ComplianceEntity)

RETURN
    center.id AS center_node,

    collect(
        DISTINCT {
            direction: "DEPENDS_ON_THIS",
            component: upstream.id,
            component_type: upstream.type,
            relationship: type(r1)
        }
    ) AS upstream_dependencies,

    collect(
        DISTINCT {
            direction: "REQUIRED_BY_THIS",
            component: downstream.id,
            component_type: downstream.type,
            relationship: type(r2)
        }
    ) AS downstream_dependencies
"""

GET_COMPONENT_CONTEXT_QUERY = """
MATCH (n:ComplianceEntity {id: $component})

OPTIONAL MATCH (n)-[r1]->(outgoing)

OPTIONAL MATCH (incoming)-[r2]->(n)

RETURN
    n.id AS component_id,
    n.type AS component_type,

    collect(
        DISTINCT {
            direction: "OUTGOING",
            relationship: type(r1),
            target: outgoing.id,
            target_type: outgoing.type,
            operator: r1.operator,
            min_version: r1.min_version
        }
    ) AS outgoing_rules,

    collect(
        DISTINCT {
            direction: "INCOMING",
            relationship: type(r2),
            source: incoming.id,
            source_type: incoming.type,
            operator: r2.operator,
            min_version: r2.min_version
        }
    ) AS incoming_rules
"""

# -----------------------------------------------------------------------------
# Fetch all known unique component names (IDs) for normalization vocabulary
# -----------------------------------------------------------------------------
GET_GLOBAL_VOCABULARY_QUERY = """
MATCH (n:ComplianceEntity)
RETURN DISTINCT n.id AS name
"""

# =============================================================================
# PRODUCT POLICY GRAPH CYPHER QUERIES
# =============================================================================

MERGE_POLICY_NODE_QUERY = """
MERGE (n:PolicyEntity {id: $id})
SET n.type = $type
SET n:{type}
RETURN n
"""

MERGE_POLICY_RELATIONSHIP_QUERY = """
MATCH (source:PolicyEntity {id: $source_id})
MATCH (target:PolicyEntity {id: $target_id})
WHERE NOT EXISTS {
    MATCH (source)-[existing:{rel_type}]->(target)
    WHERE existing.operator = $operator
      AND existing.min_version = $min_version
}
CREATE (source)-[r:{rel_type}]->(target)
SET r.operator = $operator,
    r.min_version = $min_version
RETURN r
"""

GET_FULL_POLICY_GRAPH_QUERY = """
MATCH (source:PolicyEntity)-[r]->(target:PolicyEntity)
RETURN source.id AS source_id,
       source.type AS source_type,
       type(r) AS relationship_type,
       r.operator AS operator,
       r.min_version AS min_version,
       target.id AS target_id,
       target.type AS target_type
"""

GET_POLICY_ALL_NODES_QUERY = """
MATCH (n:PolicyEntity)
RETURN DISTINCT
       n.id AS id,
       n.type AS type
ORDER BY type, id
"""

GET_POLICY_ALL_RELATIONSHIPS_QUERY = """
MATCH (source:PolicyEntity)-[r]->(target:PolicyEntity)
RETURN DISTINCT
       source.id AS source_id,
       source.type AS source_type,
       type(r) AS relationship_type,
       r.operator AS operator,
       r.min_version AS min_version,
       target.id AS target_id,
       target.type AS target_type
ORDER BY source_id, relationship_type, target_id
"""

CLEAR_POLICY_GRAPH_QUERY = """
MATCH (n:PolicyEntity) DETACH DELETE n
"""

MERGE_POLICY_METADATA_QUERY = """
MERGE (m:PolicyRulesetMetadata {id: "singleton"})
SET m += $metadata
RETURN m
"""

GET_POLICY_METADATA_QUERY = """
MATCH (m:PolicyRulesetMetadata {id: "singleton"})
RETURN m
"""