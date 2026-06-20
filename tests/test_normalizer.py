import pytest
import pandas as pd
import json
import tempfile
from pathlib import Path
from src.ingestion.normalizer import InventoryNormalizer
from src.ingestion.file_parsers import parse_inventory_file

@pytest.fixture
def normalizer():
    return InventoryNormalizer(match_threshold=85.0)

@pytest.fixture
def global_vocab():
    return {"BIOS", "Intel Chipset Driver", "OperatingSystem", "Dell Command Update"}

def test_canonical_passes_through(normalizer, global_vocab):
    canonical_input = [
        {
            "device_id": "DEVICE-001",
            "components": [
                {"name": "BIOS", "version": "2.0.0"}
            ]
        }
    ]
    output = normalizer.normalize(canonical_input, global_vocab)
    assert output == canonical_input

def test_device_id_alias(normalizer, global_vocab):
    raw_input = [{"hostname": "DEVICE-001", "bios": "2.0.0"}]
    output = normalizer.normalize(raw_input, global_vocab)
    
    assert len(output) == 1
    assert output[0]["device_id"] == "DEVICE-001"
    
def test_component_alias(normalizer, global_vocab):
    raw_input = [{"hostname": "DEVICE-001", "bios_version": "2.0.0"}]
    output = normalizer.normalize(raw_input, global_vocab)
    
    assert output[0]["components"][0]["name"] == "BIOS"
    assert output[0]["components"][0]["version"] == "2.0.0"

def test_fuzzy_mapping(normalizer, global_vocab):
    # intel_chipset_driver_version should fuzzily match Intel Chipset Driver
    raw_input = [{"hostname": "DEVICE-001", "intel_chipset_driver_version": "7.4"}]
    output = normalizer.normalize(raw_input, global_vocab)
    
    assert output[0]["components"][0]["name"] == "Intel Chipset Driver"
    assert output[0]["components"][0]["version"] == "7.4"

def test_csv_inventory_normalization(normalizer, global_vocab):
    with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False) as f:
        f.write("hostname,bios_version,intel_chipset\nDEVICE-001,2.0.0,7.4\n")
        f_path = f.name
        
    try:
        raw_records = parse_inventory_file(f_path)
        output = normalizer.normalize(raw_records, global_vocab)
        
        assert len(output) == 1
        assert output[0]["device_id"] == "DEVICE-001"
        names = {c["name"] for c in output[0]["components"]}
        assert "BIOS" in names
        assert "Intel Chipset Driver" in names
    finally:
        Path(f_path).unlink()

def test_xlsx_inventory_normalization(normalizer, global_vocab):
    df = pd.DataFrame([
        {"machine_name": "DEVICE-002", "os": "Windows 11", "dcu": "4.5"}
    ])
    with tempfile.NamedTemporaryFile(mode='wb', suffix='.xlsx', delete=False) as f:
        df.to_excel(f.name, index=False)
        f_path = f.name
        
    try:
        raw_records = parse_inventory_file(f_path)
        output = normalizer.normalize(raw_records, global_vocab)
        
        assert len(output) == 1
        assert output[0]["device_id"] == "DEVICE-002"
        names = {c["name"] for c in output[0]["components"]}
        assert "OperatingSystem" in names
        assert "Dell Command Update" in names
    finally:
        Path(f_path).unlink()

def test_json_inventory_normalization(normalizer, global_vocab):
    raw_data = {"computer_name": "DEVICE-003", "bios": "1.5", "chipset_driver": "10.1"}
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(raw_data, f)
        f_path = f.name
        
    try:
        raw_records = parse_inventory_file(f_path)
        output = normalizer.normalize(raw_records, global_vocab)
        
        assert len(output) == 1
        assert output[0]["device_id"] == "DEVICE-003"
        names = {c["name"] for c in output[0]["components"]}
        assert "BIOS" in names
        assert "Intel Chipset Driver" in names
    finally:
        Path(f_path).unlink()
