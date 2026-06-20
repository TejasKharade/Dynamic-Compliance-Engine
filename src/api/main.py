from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from src.core.compliance_evaluator import evaluate_inventory, evaluate_inventory_from_db
from src.database.neo4j_client import Neo4jClient
from src.ingestion.text_extractor import extract_rules_from_file
from src.schemas import ComplianceGraphDocument, DeviceComplianceReport
from src.agent.compliance_react_agent import ask_agent
from src.agent.report_store import clear_reports, register_report, list_report_ids, count_reports
from src.ingestion.file_parsers import parse_inventory_file
from datetime import datetime
 


app = FastAPI(
    title="Dynamic Compatibility & Configuration Compliance Engine",
    version="1.0.0",
)
 

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class EvaluateRequest(BaseModel):
    graph: ComplianceGraphDocument
    inventory: list[dict[str, Any]] = Field(
        description="List of device inventory records"
    )

class ChatRequest(BaseModel):
    session_id: str = Field(default="default")
    question: str

class ChatResponse(BaseModel):
    session_id: str
    answer: str
    tools_used: list[str] = Field(default_factory=list)

def _save_upload_to_tempfile(upload: UploadFile) -> Path:
    suffix = Path(upload.filename or "").suffix or ".tmp"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        shutil.copyfileobj(upload.file, tmp)
    finally:
        tmp.close()
    return Path(tmp.name)


def _load_inventory_json_from_upload(upload: UploadFile) -> list[dict[str, Any]]:
    try:
        raw = upload.file.read()
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, list):
            raise ValueError("Inventory JSON must be a list of device objects.")
        return data
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid inventory JSON: {exc}")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/evaluate", response_model=list[DeviceComplianceReport])
def evaluate_from_files(
    rules_file: UploadFile = File(...),
    inventory_file: UploadFile = File(...),
):
    """
    Upload:
      - rules file (.txt or .pdf)
      - inventory file (.json)

    Returns deterministic compliance reports.
    """
    rules_path = _save_upload_to_tempfile(rules_file)
    try:
        graph = extract_rules_from_file(str(rules_path))
    finally:
        rules_path.unlink(missing_ok=True)

    inventory = _load_inventory_json_from_upload(inventory_file)
    clear_reports()

    reports = evaluate_inventory(graph, inventory)

    for report in reports:
        register_report(report)

    return reports


@app.post("/evaluate-json", response_model=list[DeviceComplianceReport])
def evaluate_from_json(payload: EvaluateRequest):
    """
    Useful for frontend or tests when the graph is already extracted.
    """
    clear_reports()

    reports = evaluate_inventory(payload.graph, payload.inventory)

    for report in reports:
        register_report(report)

    return reports


@app.get("/graph/full")
def get_full_graph():
    """
    Returns the latest graph stored in Neo4j.
    """
    try:
        with Neo4jClient() as db:
            db.verify_connection()
            return {"graph": db.get_full_graph()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/ingest-rules")
def ingest_rules_only(rules_file: UploadFile = File(...)):
    """
    Extract rules from a file and store them in Neo4j only.
    """
    rules_path = _save_upload_to_tempfile(rules_file)
    try:
        graph = extract_rules_from_file(str(rules_path))
    finally:
        rules_path.unlink(missing_ok=True)

    try:
        with Neo4jClient() as db:
            db.verify_connection()
            db.clear_graph()
            db.push_graph(graph)
            
            metadata = {
                "ruleset_name": rules_file.filename or "Unknown Ruleset",
                "uploaded_at": datetime.utcnow().isoformat() + "Z",
                "node_count": len(graph.nodes),
                "relationship_count": len(graph.relationships)
            }
            db.save_metadata(metadata)
            
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "message": "Rules extracted and persisted to Neo4j successfully.",
        "nodes": len(graph.nodes),
        "relationships": len(graph.relationships),
    }

@app.post("/evaluate-inventory", response_model=list[DeviceComplianceReport])
def evaluate_inventory_only(inventory_file: UploadFile = File(...)):
    """
    Evaluate an inventory file using the active graph stored in Neo4j.
    """
    inv_path = _save_upload_to_tempfile(inventory_file)
    try:
        inventory = parse_inventory_file(str(inv_path))
    except Exception as exc:
        inv_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Invalid inventory file: {exc}")
    finally:
        inv_path.unlink(missing_ok=True)
        
    clear_reports()
    try:
        reports = evaluate_inventory_from_db(inventory)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
        
    for report in reports:
        register_report(report)

    return reports

@app.get("/system/status")
def system_status():
    try:
        with Neo4jClient() as db:
            db.verify_connection()
            metadata = db.get_metadata()
            
        metadata["reports_cached"] = count_reports()
        return metadata
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/evaluate-neo4j", response_model=list[DeviceComplianceReport])
def evaluate_from_rules_and_inventory_files(
    rules_file: UploadFile = File(...),
    inventory_file: UploadFile = File(...),
):
    """
    Same as /evaluate, but explicitly exposes the Neo4j-backed path.
    """
    rules_path = _save_upload_to_tempfile(rules_file)
    try:
        graph = extract_rules_from_file(str(rules_path))
    finally:
        rules_path.unlink(missing_ok=True)

    inventory = _load_inventory_json_from_upload(inventory_file)
    clear_reports()

    reports = evaluate_inventory(graph, inventory)

    for report in reports:
        register_report(report)

    return reports
@app.get("/graph/network")
def get_graph_network():
    """
    Returns graph data in a frontend-friendly format:
    - nodes: all ComplianceEntity nodes
    - edges: all relationships between them
    """
    try:
        with Neo4jClient() as db:
            db.verify_connection()
            return db.get_graph_network()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    

@app.get("/impact")
def get_impact(component: str):
    try:
        with Neo4jClient() as db:
            db.verify_connection()

            results = db.get_impact_analysis(component)

            return {
                "component": component,
                "count": len(results),
                "affected_components": results,
            }

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )
    
@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    try:
        result = ask_agent(
            question=request.question,
            session_id=request.session_id,
        )
        return ChatResponse(**result)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

 

@app.get("/debug/cache")
def debug_cache():
    return {
        "count": count_reports(),
        "device_ids": list_report_ids(),
    }