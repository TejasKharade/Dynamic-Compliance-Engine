import os
from dotenv import load_dotenv
from neo4j import GraphDatabase
from neo4j.exceptions import ServiceUnavailable, AuthError

from src.schemas import ComplianceNode, ComplianceRelationship, ComplianceGraphDocument
from src.policy_schemas import PolicyNode, PolicyRelationship, PolicyGraphDocument
from src.database.cypher_queries import (
    MERGE_NODE_QUERY,
    MERGE_RELATIONSHIP_QUERY,
    CLEAR_GRAPH_QUERY,
    GET_FULL_GRAPH_QUERY,
    GET_ALL_NODES_QUERY,
    GET_ALL_RELATIONSHIPS_QUERY,
    GET_IMPACT_ANALYSIS_QUERY,
    GET_COMPONENT_CONTEXT_QUERY,
    GET_RELEVANT_RELATIONSHIPS_QUERY,
    MERGE_METADATA_QUERY,
    GET_METADATA_QUERY,
    GET_GLOBAL_VOCABULARY_QUERY,
    # Policy queries
    MERGE_POLICY_NODE_QUERY,
    MERGE_POLICY_RELATIONSHIP_QUERY,
    GET_FULL_POLICY_GRAPH_QUERY,
    GET_POLICY_ALL_NODES_QUERY,
    GET_POLICY_ALL_RELATIONSHIPS_QUERY,
    CLEAR_POLICY_GRAPH_QUERY,
    MERGE_POLICY_METADATA_QUERY,
    GET_POLICY_METADATA_QUERY,
)

load_dotenv()


class Neo4jClient:
    """
    Manages the connection to Neo4j and provides methods to persist
    the extracted compliance knowledge graph.

    Usage (recommended — automatic cleanup):
        with Neo4jClient() as db:
            db.push_graph(graph_doc)

    Usage (manual):
        db = Neo4jClient()
        db.push_graph(graph_doc)
        db.close()
    """

    def __init__(self):
        uri      = os.getenv("NEO4J_URI",      "bolt://localhost:7687")
        username = os.getenv("NEO4J_USERNAME",  "neo4j")
        password = os.getenv("NEO4J_PASSWORD")

        if not password:
            raise ValueError(
                "NEO4J_PASSWORD is not set. "
                "Please add it to your .env file."
            )

        self._driver = GraphDatabase.driver(uri, auth=(username, password))

    # ------------------------------------------------------------------
    # Context manager support — ensures the driver is always closed
    # ------------------------------------------------------------------
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def close(self):
        """Close the Neo4j driver connection."""
        self._driver.close()

    # ------------------------------------------------------------------
    # Connection check
    # ------------------------------------------------------------------
    def verify_connection(self):
        """
        Pings Neo4j to confirm the connection is alive.
        Raises a clear error if the database is not reachable.
        """
        try:
            self._driver.verify_connectivity()
            print("[Neo4j] Connection verified successfully.")
        except ServiceUnavailable:
            raise ConnectionError(
                "Cannot reach Neo4j at the configured URI. "
                "Make sure Neo4j Desktop is running and your NEO4J_URI is correct."
            )
        except AuthError:
            raise ConnectionError(
                "Neo4j authentication failed. "
                "Check your NEO4J_USERNAME and NEO4J_PASSWORD in .env"
            )

    # ------------------------------------------------------------------
    # Graph management
    # ------------------------------------------------------------------
    def clear_graph(self):
        """
        Deletes ALL nodes and relationships from the database.
        Call this before re-ingesting a document for a clean slate.
        """
        with self._driver.session() as session:
            session.run(CLEAR_GRAPH_QUERY)
        print("[Neo4j] Graph cleared — all nodes and relationships deleted.")

    # ------------------------------------------------------------------
    # Metadata management
    # ------------------------------------------------------------------
    def save_metadata(self, metadata: dict):
        """
        Save ruleset metadata to a singleton node.
        """
        with self._driver.session() as session:
            session.run(MERGE_METADATA_QUERY, metadata=metadata)
            
    def get_metadata(self) -> dict:
        """
        Retrieve ruleset metadata from the singleton node.
        """
        with self._driver.session() as session:
            result = session.run(GET_METADATA_QUERY)
            record = result.single()
            if not record:
                return {
                    "graph_loaded": False,
                    "active_ruleset": None,
                    "nodes": 0,
                    "relationships": 0
                }
            
            node = record["m"]
            return {
                "graph_loaded": True,
                "active_ruleset": node.get("ruleset_name"),
                "uploaded_at": node.get("uploaded_at"),
                "nodes": node.get("node_count", 0),
                "relationships": node.get("relationship_count", 0)
            }

    # ------------------------------------------------------------------
    # Node upsert
    # ------------------------------------------------------------------
    def upsert_node(self, node: ComplianceNode):
        """
        MERGE a single ComplianceNode into Neo4j.
        - If a node with this id already exists, it is updated in-place.
        - If it doesn't exist, it is created.
        - Also applies a specific Neo4j label (e.g. :BIOS, :Driver)
          so nodes can be filtered by type in the Neo4j Browser.
        """
        query = MERGE_NODE_QUERY.format(type=node.type)
        with self._driver.session() as session:
            session.run(query, id=node.id, type=node.type)

    # ------------------------------------------------------------------
    # Relationship upsert
    # ------------------------------------------------------------------
    def upsert_relationship(self, rel: ComplianceRelationship):
        """
        MERGE a single ComplianceRelationship into Neo4j.
        - Looks up source and target nodes by their id.
        - If the relationship already exists between those two nodes, 
          it is updated with the latest operator and min_version.
        - Skips silently if either endpoint node doesn't exist in the DB.
        """
        query = MERGE_RELATIONSHIP_QUERY.format(rel_type=rel.type)
        with self._driver.session() as session:
            session.run(
                query,
                source_id=rel.source,
                target_id=rel.target,
                operator=rel.operator,
                min_version=rel.min_version,
            )

    # ------------------------------------------------------------------
    # Bulk push — the main entry point
    # ------------------------------------------------------------------
    def push_graph(self, graph_doc: ComplianceGraphDocument):
        """
        Persist an entire ComplianceGraphDocument to Neo4j.
        Pushes all nodes first (so relationship endpoints exist),
        then pushes all relationships.
        """
        print(f"\n[Neo4j] Pushing {len(graph_doc.nodes)} nodes...")
        for node in graph_doc.nodes:
            self.upsert_node(node)
            print(f"  [+] ({node.type}) {node.id}")

        print(f"\n[Neo4j] Pushing {len(graph_doc.relationships)} relationships...")
        for rel in graph_doc.relationships:
            self.upsert_relationship(rel)
            ver_label = f" ({rel.operator}{rel.min_version})" if rel.min_version else ""
            print(f"  [+] {rel.source} --[{rel.type}{ver_label}]--> {rel.target}")

        print("\n[Neo4j] Graph successfully persisted!")
        print("[Neo4j] Open Neo4j Browser at http://localhost:7474")
        print("[Neo4j] Run: MATCH (n) RETURN n   to visualize your graph.")

    # ------------------------------------------------------------------
    # Read — fetch full graph back from Neo4j
    # ------------------------------------------------------------------
    def get_full_graph(self) -> list:
        """
        Retrieve all nodes and relationships from Neo4j.
        Returns a list of record dicts for further processing.
        """
        with self._driver.session() as session:
            result = session.run(GET_FULL_GRAPH_QUERY)
            return [dict(record) for record in result]
        
    

    def get_relevant_relationships(self, entity_ids: list[str]) -> list[dict]:
        """
        Return only the rules whose source entity exists in the given device inventory.
        """
        if not entity_ids:
            return []

        with self._driver.session() as session:
            result = session.run(
                GET_RELEVANT_RELATIONSHIPS_QUERY,
                entity_ids=entity_ids,
            )
            return [dict(record) for record in result]
        
    def get_graph_network(self) -> dict:
        """
        Return the graph in frontend-friendly format:
        {
            "nodes": [...],
            "edges": [...]
        }

        Includes all ComplianceEntity nodes, even if some are isolated.
        """
        with self._driver.session() as session:
            nodes_result = session.run(GET_ALL_NODES_QUERY)
            edges_result = session.run(GET_ALL_RELATIONSHIPS_QUERY)

            nodes = [dict(record) for record in nodes_result]
            edges = [dict(record) for record in edges_result]

        return {"nodes": nodes, "edges": edges}
    
    def get_impact_analysis(
        self,
        node_id: str,
    ) -> dict:

        with self._driver.session() as session:

            result = session.run(
                GET_IMPACT_ANALYSIS_QUERY,
                node_id=node_id,
            )

            record = result.single()

            if not record:
                return {}

            return dict(record)
        

    def get_component_context(
        self,
        component: str,
    ):
        with self._driver.session() as session:

            result = session.run(
                GET_COMPONENT_CONTEXT_QUERY,
                component=component,
            )

            record = result.single()

            if not record:
                return None

            return dict(record)

    def get_global_vocabulary(self) -> set[str]:
        """
        Return a set of all unique component names (IDs) known to the graph.
        Useful for normalizers and fuzzy matching.
        """
        with self._driver.session() as session:
            result = session.run(GET_GLOBAL_VOCABULARY_QUERY)
            return {record["name"] for record in result}

    # ------------------------------------------------------------------
    # Product Policy Graph persistence & retrieval
    # ------------------------------------------------------------------
    def clear_policy_graph(self):
        """Deletes all policy nodes and relationships from the database."""
        with self._driver.session() as session:
            session.run(CLEAR_POLICY_GRAPH_QUERY)
        print("[Neo4j] Policy graph cleared — all policy nodes and relationships deleted.")

    def save_policy_metadata(self, metadata: dict):
        """Save policy ruleset metadata to a singleton node."""
        with self._driver.session() as session:
            session.run(MERGE_POLICY_METADATA_QUERY, metadata=metadata)
            
    def get_policy_metadata(self) -> dict:
        """Retrieve policy ruleset metadata from the singleton node."""
        with self._driver.session() as session:
            result = session.run(GET_POLICY_METADATA_QUERY)
            record = result.single()
            if not record:
                return {
                    "graph_loaded": False,
                    "active_ruleset": None,
                    "nodes": 0,
                    "relationships": 0
                }
            node = record["m"]
            return {
                "graph_loaded": True,
                "active_ruleset": node.get("ruleset_name"),
                "uploaded_at": node.get("uploaded_at"),
                "nodes": node.get("node_count", 0),
                "relationships": node.get("relationship_count", 0)
            }

    def upsert_policy_node(self, node: PolicyNode):
        """MERGE a single PolicyNode into Neo4j."""
        query = MERGE_POLICY_NODE_QUERY.format(type=node.type)
        with self._driver.session() as session:
            session.run(query, id=node.id, type=node.type)

    def upsert_policy_relationship(self, rel: PolicyRelationship):
        """MERGE a single PolicyRelationship into Neo4j."""
        query = MERGE_POLICY_RELATIONSHIP_QUERY.format(rel_type=rel.type)
        with self._driver.session() as session:
            session.run(
                query,
                source_id=rel.source,
                target_id=rel.target,
                operator=rel.operator,
                min_version=rel.min_version,
            )

    def push_policy_graph(self, graph_doc: PolicyGraphDocument):
        """Persist an entire PolicyGraphDocument to Neo4j."""
        print(f"\n[Neo4j] Pushing {len(graph_doc.nodes)} policy nodes...")
        for node in graph_doc.nodes:
            self.upsert_policy_node(node)
            print(f"  [+] ({node.type}) {node.id}")

        print(f"\n[Neo4j] Pushing {len(graph_doc.relationships)} policy relationships...")
        for rel in graph_doc.relationships:
            self.upsert_policy_relationship(rel)
            ver_label = f" ({rel.operator}{rel.min_version})" if rel.min_version else ""
            print(f"  [+] {rel.source} --[{rel.type}{ver_label}]--> {rel.target}")

        print("\n[Neo4j] Policy graph successfully persisted!")

    def get_full_policy_graph(self) -> list:
        """Retrieve all policy relationships from Neo4j."""
        with self._driver.session() as session:
            result = session.run(GET_FULL_POLICY_GRAPH_QUERY)
            return [dict(record) for record in result]

    def get_policy_graph_network(self) -> dict:
        """Return the policy graph in frontend-friendly format."""
        with self._driver.session() as session:
            nodes_result = session.run(GET_POLICY_ALL_NODES_QUERY)
            edges_result = session.run(GET_POLICY_ALL_RELATIONSHIPS_QUERY)

            nodes = [dict(record) for record in nodes_result]
            edges = [dict(record) for record in edges_result]

        return {"nodes": nodes, "edges": edges}