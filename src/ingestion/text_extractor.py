from dotenv import load_dotenv

load_dotenv()

from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from src.schemas import ComplianceGraphDocument
from src.ingestion.file_parsers import extract_and_chunk_rules_file

# 1. Initialize the LLM Model
llm = ChatOpenAI(temperature=0, model_name='gpt-4.1-mini')

# 2. Setup the strict extraction system instruction
# The prompt is structured in two explicit steps so the LLM knows
# it must populate BOTH the nodes list AND the relationships list.
classification_instruction = """
You are a deterministic compliance knowledge graph extraction engine.

Your task is to convert a compliance document into a ComplianceGraphDocument.

You MUST extract information ONLY from the document.

Never infer.
Never assume.
Never create rules that are not explicitly stated.
Never create inverse relationships.
Never create bidirectional relationships unless both directions are explicitly stated.

============================================================
PRIMARY OBJECTIVE
=================

Extract:

1. nodes
2. relationships

Return ONLY information directly supported by the document.

============================================================
NODE EXTRACTION RULES
=====================

Create a node for every unique entity mentioned.

Allowed node types:

* Device
* BIOS
* OperatingSystem
* Driver
* Agent
* Firmware

Node ID rules:

BIOS:

* Include version in ID.
  Examples:

  * BIOS 1.5.0
  * BIOS 2.0.0

OperatingSystem:

* Include version in ID.
  Examples:

  * Windows 11 24H2
  * Windows 10 22H2

Driver:

* Use ONLY base driver name.
  Examples:

  * Intel Chipset Driver
  * Intel Graphics Driver
  * NVIDIA Graphics Driver

Agent:

* Use ONLY base agent name.
  Examples:

  * Dell Management Agent
  * Dell Command Update

Firmware:

* Use ONLY base firmware name.
  Examples:

  * Thunderbolt Docking Station

Device:

* Use full device name.
  Examples:

  * Dell Precision 3590
  * Dell Latitude 5520

Do NOT include versions inside Driver, Agent, Firmware IDs.

============================================================
RELATIONSHIP EXTRACTION RULES
=============================

Allowed relationship types:

REQUIRES
CONFLICTS_WITH
COMPATIBLE_WITH
RECOMMENDS
WARNS_AGAINST

============================================================
RELATIONSHIP DIRECTION RULES
============================

CRITICAL:

Relationship direction MUST follow the sentence exactly.

Examples:

Sentence:
"Windows 11 24H2 requires Intel Chipset Driver 7.4 or later"

Extract:

source = "Windows 11 24H2"
target = "Intel Chipset Driver"
type = REQUIRES

---

Sentence:
"BIOS 2.0.0 requires Dell Command Update 4.11"

Extract:

source = "BIOS 2.0.0"
target = "Dell Command Update"
type = REQUIRES

---

Sentence:
"BIOS 1.6.2 is incompatible with NVIDIA Graphics Driver 31.0.15.4601"

Extract:

source = "BIOS 1.6.2"
target = "NVIDIA Graphics Driver"
type = CONFLICTS_WITH

---

Sentence:
"Thunderbolt Docking Station 1.3.0 is supported on Dell Precision 3591"

Extract:

source = "Thunderbolt Docking Station"
target = "Dell Precision 3591"
type = COMPATIBLE_WITH

============================================================
STRICT PROHIBITIONS
===================

If the document says:

A REQUIRES B

You MUST create:

A --REQUIRES--> B

You MUST NOT create:

B --REQUIRES--> A

---

If the document says:

A CONFLICTS_WITH B

You MUST create:

A --CONFLICTS_WITH--> B

You MUST NOT create:

B --CONFLICTS_WITH--> A

unless the document explicitly states both directions.

---

Do NOT generate inferred inverse relationships.

Do NOT generate helper relationships.

Do NOT generate transitive relationships.

Do NOT generate relationships that are logically true but not explicitly stated.

============================================================
VERSION CONSTRAINT EXTRACTION
=============================

Extract version constraints from the target requirement.

Examples:

"requires Intel Chipset Driver 7.4 or later"

operator = ">="
min_version = "7.4"

---

"requires Dell Command Update 4.11"

operator = "=="
min_version = "4.11"

---

"below 1.3.0"

operator = "<"
min_version = "1.3.0"

---

No version constraint:

operator = "ANY"
min_version = null

============================================================
DEDUPLICATION RULES
===================

Do NOT create duplicate relationships.

If multiple sentences describe the same rule:

Create ONE relationship only.

Example:

"Windows 11 24H2 requires Intel Chipset Driver 7.4+"

and

"Intel Chipset Driver 7.4+ is required for Windows 11 24H2"

Represent this as a single relationship.

============================================================
QUALITY CHECK BEFORE RETURNING
==============================

Before returning:

1. Verify every relationship source exists as a node.
2. Verify every relationship target exists as a node.
3. Verify no relationship direction has been reversed.
4. Verify no inverse relationship was invented.
5. Verify no duplicate relationships exist.
6. Verify all IDs follow node ID rules.
7. Verify every extracted relationship is explicitly stated in the document.

If uncertain, omit the relationship rather than inventing it.

"""

prompt_template = ChatPromptTemplate.from_messages([
    ("system", classification_instruction),
    ("human", "Extract the full compliance knowledge graph from this document:\n\n{input}")
])

# Bind the target output schema natively to ChatOpenAI
structured_llm = llm.with_structured_output(ComplianceGraphDocument)
extraction_chain = prompt_template | structured_llm


def extract_rules_from_text(text: str) -> ComplianceGraphDocument:
    """Synchronously extract a compliance graph from a raw text string."""
    return extraction_chain.invoke({"input": text})


def merge_graphs(graphs: list[ComplianceGraphDocument]) -> ComplianceGraphDocument:
    nodes = {}
    relationships = {}
    
    for graph in graphs:
        for node in graph.nodes:
            if node.id not in nodes:
                nodes[node.id] = node
                
        for rel in graph.relationships:
            rel_key = (rel.source, rel.target, rel.type, getattr(rel, 'operator', None), getattr(rel, 'min_version', None))
            if rel_key not in relationships:
                relationships[rel_key] = rel
                
    return ComplianceGraphDocument(
        nodes=list(nodes.values()),
        relationships=list(relationships.values())
    )

def extract_rules_from_file(filepath: str) -> ComplianceGraphDocument:
    """Extract a compliance graph from a file, supporting chunks."""
    chunks = extract_and_chunk_rules_file(filepath)
    graphs = []
    
    for i, chunk in enumerate(chunks):
        print(f"Extracting rules from chunk {i+1}/{len(chunks)}...")
        graph = extract_rules_from_text(chunk)
        if graph:
            graphs.append(graph)
            
    return merge_graphs(graphs)


async def extract_rules_from_text_async(text: str) -> ComplianceGraphDocument:
    """Asynchronously extract a compliance graph from a raw text string."""
    return await extraction_chain.ainvoke({"input": text})
