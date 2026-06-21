import pytest
from src.core.compliance_evaluator import evaluate_device, _compare_versions
from src.schemas import ComplianceGraphDocument, ComplianceNode, ComplianceRelationship

def test_version_normalization_compare():
    assert _compare_versions("1.2.3", "==", "1.2.3") == True
    assert _compare_versions("2.0.0", ">=", "1.5.0") == True
    assert _compare_versions("1.0", "<", "2.0") == True
    assert _compare_versions("Windows 11 23H2", "==", "Windows 11 23H2") == True
    assert _compare_versions("10.0.22621", ">=", "10.0.19044") == True
    assert _compare_versions("45 TOPS", ">=", "40") == True
    assert _compare_versions("20 TOPS", ">=", "40") == False
    assert _compare_versions("8 GB", ">=", "16") == False

def test_hard_incompatibility_detection():
    # A device has Windows Server AND Docker Desktop
    inventory = {
        "device_id": "SERVER-01",
        "components": [
            {"name": "OperatingSystem", "version": "Windows Server 2022"},
            {"name": "Docker Desktop", "version": "4.20.0"}
        ]
    }
    # Rule: Docker Desktop conflicts with Windows Server
    rels = [
        {
            "source_id": "Docker Desktop",
            "target_id": "Windows Server",
            "target_type": "OperatingSystem",
            "relationship_type": "CONFLICTS_WITH",
            "operator": "ANY"
        }
    ]
    vocab = {"Docker Desktop", "Windows Server"}
    
    report = evaluate_device(rels, inventory, vocab)
    
    assert report.is_compliant is False
    assert len(report.findings) == 1
    assert report.findings[0].severity == "CRITICAL"
    assert report.findings[0].rule_type == "CONFLICTS_WITH"

def test_optional_recommendation_handling():
    inventory = {
        "device_id": "DEV-01",
        "components": [
            {"name": "Memory", "version": "8"},
            {"name": "Software X", "version": "1.0"}
        ]
    }
    # Rule: Recommends 16GB
    rels = [
        {
            "source_id": "Software X",
            "target_id": "Memory",
            "target_type": "Hardware",
            "relationship_type": "RECOMMENDS",
            "operator": ">=",
            "min_version": "16"
        }
    ]
    vocab = {"Software X", "Memory"}
    
    report = evaluate_device(rels, inventory, vocab)
    
    # Recommendations don't cause non-compliance
    assert report.is_compliant is True
    assert len(report.findings) == 1
    assert report.findings[0].severity == "INFO"

def test_warning_handling():
    inventory = {
        "device_id": "DEV-01",
        "components": [
            {"name": "BIOS", "version": "1.0.0"},
            {"name": "System", "version": "1.0"}
        ]
    }
    rels = [
        {
            "source_id": "System",
            "target_id": "BIOS",
            "target_type": "Firmware",
            "relationship_type": "WARNS_AGAINST",
            "operator": "<",
            "min_version": "1.2.0"
        }
    ]
    vocab = {"System", "BIOS"}
    
    report = evaluate_device(rels, inventory, vocab)
    
    assert report.is_compliant is True
    assert len(report.findings) == 1
    assert report.findings[0].severity == "WARNING"

def test_docker_desktop_windows_document_compliant():
    # Compliant inventory
    inventory = {
        "device_id": "DEV-DOCKER",
        "components": [
            {"name": "Docker Desktop", "version": "4.20.0"},
            {"name": "OperatingSystem", "version": "Windows 11 Home 23H2"},
            {"name": "Memory", "version": "16"},
            {"name": "Processor", "version": "Intel Core i7 (64-bit)"},
            {"name": "Windows Subsystem for Linux", "version": "2.2.0"},
            {"name": "Virtualization", "version": "Enabled"}
        ]
    }
    
    rels = [
        # Requires Windows 11 21H2 or later
        {
            "source_id": "Docker Desktop",
            "target_id": "Windows 11",
            "target_type": "OperatingSystem",
            "relationship_type": "REQUIRES",
            "operator": ">=",
            "min_version": "21H2"
        },
        # Requires WSL 2 1.1.3 or later
        {
            "source_id": "Docker Desktop",
            "target_id": "Windows Subsystem for Linux",
            "target_type": "Feature",
            "relationship_type": "REQUIRES",
            "operator": ">=",
            "min_version": "1.1.3"
        },
        # Requires 4GB RAM
        {
            "source_id": "Docker Desktop",
            "target_id": "Memory",
            "target_type": "Hardware",
            "relationship_type": "REQUIRES",
            "operator": ">=",
            "min_version": "4"
        },
        # Requires Virtualization
        {
            "source_id": "Docker Desktop",
            "target_id": "Virtualization",
            "target_type": "Feature",
            "relationship_type": "REQUIRES",
            "operator": "ANY",
        }
    ]
    vocab = {"Docker Desktop", "Windows 11", "Windows Subsystem for Linux", "Memory", "Virtualization"}
    
    report = evaluate_device(rels, inventory, vocab)
    assert report.is_compliant is True
    assert len([f for f in report.findings if f.severity == "CRITICAL"]) == 0

def test_docker_desktop_windows_document_invalid():
    # Non-compliant inventory (Missing virtualization, old WSL)
    inventory = {
        "device_id": "DEV-DOCKER-FAIL",
        "components": [
            {"name": "Docker Desktop", "version": "4.20.0"},
            {"name": "OperatingSystem", "version": "Windows 11 Home 23H2"},
            {"name": "Memory", "version": "16"},
            {"name": "Processor", "version": "Intel Core i7 (64-bit)"},
            {"name": "Windows Subsystem for Linux", "version": "1.0.0"} # Old WSL version
            # Missing Virtualization
        ]
    }
    
    rels = [
        {
            "source_id": "Docker Desktop",
            "target_id": "Windows Subsystem for Linux",
            "target_type": "Feature",
            "relationship_type": "REQUIRES",
            "operator": ">=",
            "min_version": "1.1.3"
        },
        {
            "source_id": "Docker Desktop",
            "target_id": "Virtualization",
            "target_type": "Feature",
            "relationship_type": "REQUIRES",
            "operator": "ANY",
        }
    ]
    vocab = {"Docker Desktop", "Windows Subsystem for Linux", "Virtualization"}
    
    report = evaluate_device(rels, inventory, vocab)
    assert report.is_compliant is False
    criticals = [f for f in report.findings if f.severity == "CRITICAL"]
    assert len(criticals) == 2 # 1 for old WSL, 1 for missing Virtualization


def test_kubernetes_skew_not_newer_violation():
    inventory = {
        "device_id": "K8S-FAIL-NEWER",
        "components": [
            {"name": "kubelet", "version": "1.35.0"},
            {"name": "kube-apiserver", "version": "1.34.0"},
        ],
    }
    rels = [
        {
            "source_id": "kubelet",
            "target_id": "kube-apiserver",
            "target_type": "kube-apiserver",
            "relationship_type": "SKEW_NOT_NEWER",
            "operator": "ANY",
            "min_version": None,
        }
    ]

    report = evaluate_device(rels, inventory, {"kubelet", "kube-apiserver"})

    assert report.is_compliant is False
    assert report.findings[0].rule_type == "SKEW_NOT_NEWER"


def test_kubernetes_skew_max_older_violation():
    inventory = {
        "device_id": "K8S-FAIL-OLDER",
        "components": [
            {"name": "kubelet", "version": "1.32.0"},
            {"name": "kube-apiserver", "version": "1.36.0"},
        ],
    }
    rels = [
        {
            "source_id": "kubelet",
            "target_id": "kube-apiserver",
            "target_type": "kube-apiserver",
            "relationship_type": "SKEW_MAX_OLDER",
            "operator": "<=",
            "min_version": "3",
        }
    ]

    report = evaluate_device(rels, inventory, {"kubelet", "kube-apiserver"})

    assert report.is_compliant is False
    assert report.findings[0].rule_type == "SKEW_MAX_OLDER"
