from src.ingestion.text_extractor import extract_rules_from_file
from src.database.neo4j_client import Neo4jClient
from src.core.compliance_evaluator import evaluate_inventory
from src.ingestion.file_parsers import parse_inventory_file
from src.ingestion.normalizer import InventoryNormalizer
from src.agent.report_store import clear_reports, register_report
import sys

def run_fix():
    print("Extracting rules using the updated LLM prompt...")
    graph = extract_rules_from_file("data/rules/compatibility_v1.txt")
    print(f"Extracted {len(graph.nodes)} nodes and {len(graph.relationships)} relationships.")
    
    with Neo4jClient() as db:
        db.verify_connection()
        print("Clearing old flawed rules from Neo4j...")
        db.clear_graph()
        print("Pushing updated strict rules to Neo4j...")
        db.push_graph(graph)
        
    print("Loading inventory...")
    raw_inventory = parse_inventory_file("data/inventory/mock_devices.json")
    
    vocab = {node.id for node in graph.nodes}
    inventory = InventoryNormalizer().normalize(raw_inventory, vocab)
    
    print("Re-evaluating inventory...")
    reports = evaluate_inventory(graph, inventory)
    
    clear_reports()
    for report, inv_item in zip(reports, raw_inventory):
        register_report(report, inventory_item=inv_item)
        print(f"Device {report.device_id}: Compliant = {report.is_compliant}")

if __name__ == "__main__":
    run_fix()