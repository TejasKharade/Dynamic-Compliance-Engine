import json
from typing import Any
from dotenv import load_dotenv

load_dotenv()

from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_core.prompts import ChatPromptTemplate
from src.policy_schemas import PolicyFleetComplianceReport

llm = ChatOpenAI(temperature=0, model_name='gpt-4o-mini')
structured_llm = llm.with_structured_output(PolicyFleetComplianceReport)

prompt_template = ChatPromptTemplate.from_messages([
    ("system", 
"""You are a strict compliance evaluation engine.
You are given a host inventory (raw text) containing one or more devices, and a set of relevant policy rules retrieved from a company policy document.

Your task:
1. Identify all devices listed in the host inventory text.
2. Evaluate each device against the policy rules.
3. Generate a comprehensive overall markdown summary report of the fleet's compliance status (compatible vs. non-compatible devices, specific policy violations, and recommended remediations).

For each device evaluation:
- Determine if the device is compliant (True if no CRITICAL violations exist, False otherwise).
- Calculate a compliance score (Start at 100. Subtract 25 for CRITICAL, 10 for WARNING, 2 for INFO. Minimum 10).
- Extract findings for each rule:
  - `rule_type`: REQUIRES, CONFLICTS_WITH, RECOMMENDS, WARNS_AGAINST, etc.
  - `severity`: CRITICAL, WARNING, INFO, or PASS.
  - `source`: The product (e.g. "Docker Desktop").
  - `target`: The requirement (e.g. "WSL", "RAM", "OperatingSystem").
  - `message`: Clear explanation.
  - `remediation`: (Optional) Action, component, target_version, reason.

IMPORTANT RULES:
- Only evaluate the rules explicitly provided in the retrieved policy text.
- If a required component is missing or outdated, it is a CRITICAL violation.
- If a conflicting component is present, it is a CRITICAL violation.
- If a recommendation is missed, it is a WARNING or INFO.
- DO NOT invent rules.
- If the device meets a requirement, include a PASS finding so the user knows it was checked.
"""),
    ("human", 
"""### Retrieved Policy Rules:
{context}

### Host Inventory (Raw Text):
{device_info}

Evaluate the host inventory, identify all devices, and return the structured PolicyFleetComplianceReport with a fleet-wide markdown summary and individual device compliance evaluations.""")
])

eval_chain = prompt_template | structured_llm

def build_policy_vectorstore(text: str) -> FAISS:
    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)
    docs = splitter.create_documents([text])
    embeddings = OpenAIEmbeddings()
    vectorstore = FAISS.from_documents(docs, embeddings)
    return vectorstore

def evaluate_device_rag(device_text: str, vectorstore: FAISS) -> PolicyFleetComplianceReport:
    # We use a broad search to ensure we catch policy rules.
    retriever = vectorstore.as_retriever(search_kwargs={"k": 10})
    
    docs = retriever.invoke(device_text)
    context = "\n\n".join([doc.page_content for doc in docs])
    
    report: PolicyFleetComplianceReport = eval_chain.invoke({
        "context": context,
        "device_info": device_text
    })
    
    return report

