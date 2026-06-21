import sys
import os
from dotenv import load_dotenv
load_dotenv()

from src.ingestion.text_extractor import extract_rules_from_text

test_text = "BIOS 2.0.0 is compatible with Dell Command Update 4.11 and 4.12."
print(f"Extracting rules from: {test_text}")

graph = extract_rules_from_text(test_text)

print("\nNodes:")
for n in graph.nodes:
    print(f" - {n.id} (type: {n.type})")

print("\nRelationships:")
for r in graph.relationships:
    op = getattr(r, 'operator', None)
    mv = getattr(r, 'min_version', None)
    print(f" - {r.source} -> {r.target} [{r.type}] (op: {op}, min_version: {mv})")
