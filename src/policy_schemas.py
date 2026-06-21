from typing import Optional, List, Literal
from pydantic import BaseModel, Field

PolicyNodeType = Literal[
    "Product",
    "Requirement",
    "Property",
    "OS",
    "System",
]

PolicyRelationshipType = Literal[
    "REQUIRES",
    "CONFLICTS_WITH",
    "COMPATIBLE_WITH",
    "RECOMMENDS",
    "WARNS_AGAINST",
]

PolicyVersionOperator = Literal[">=", "<", "==", "!=", "ANY"]

PolicyFindingSeverity = Literal["PASS", "INFO", "WARNING", "CRITICAL"]


class PolicyNode(BaseModel):
    id: str = Field(
        description=(
            "The unique identifier for the policy entity. "
            "For products, use the full name (e.g., 'Docker Desktop'). "
            "For system properties/dependencies, use the name (e.g., 'WSL', 'RAM', 'Virtualization', 'OperatingSystem')."
        )
    )
    type: PolicyNodeType = Field(
        description="The category of this entity. Must be Product, Requirement, Property, OS, or System."
    )


class PolicyRelationship(BaseModel):
    source: str = Field(
        description="The id of the source node (the policy anchor product, e.g. 'Docker Desktop')."
    )
    target: str = Field(
        description="The id of the target node (the requirement/constraint, e.g. 'WSL', 'RAM', 'Virtualization', 'OperatingSystem')."
    )
    type: PolicyRelationshipType = Field(
        description="The relationship type. Must be: REQUIRES, CONFLICTS_WITH, COMPATIBLE_WITH, RECOMMENDS, WARNS_AGAINST."
    )
    min_version: Optional[str] = Field(
        None,
        description="The constraint value (e.g. '2.1.5', '8 GB', 'Enabled'). Extract the version or state."
    )
    operator: PolicyVersionOperator = Field(
        "ANY",
        description="The comparison operator ('>=', '==', '!=', '<', 'ANY')."
    )


class PolicyGraphDocument(BaseModel):
    nodes: List[PolicyNode] = Field(
        description="A list of ALL unique entities (products and properties) found."
    )
    relationships: List[PolicyRelationship] = Field(
        description="A list of ALL policy requirements/relationships."
    )


class PolicyRemediation(BaseModel):
    component: str = Field(description="The component/property to fix.")
    action: str = Field(description="Remediation action, e.g. upgrade, install, configure, enable, remove.")
    target_version: Optional[str] = Field(None, description="Target version or value if applicable.")
    reason: str = Field(description="Reason for the remediation action.")


class PolicyFinding(BaseModel):
    rule_type: PolicyRelationshipType = Field(description="The relationship type producing the finding.")
    severity: PolicyFindingSeverity = Field(description="Severity (CRITICAL, WARNING, INFO, PASS).")
    source: str = Field(description="Source product (e.g. Docker Desktop).")
    target: str = Field(description="Target constraint (e.g. WSL).")
    message: str = Field(description="Human readable explanation of the violation/status.")
    remediation: Optional[PolicyRemediation] = Field(None, description="Remediation instructions.")


class PolicyComplianceReport(BaseModel):
    device_id: str = Field(description="ID of the evaluated device.")
    compliance_score: int = Field(ge=0, le=100, description="Compliance score (0-100).")
    is_compliant: bool = Field(description="True if no CRITICAL violations exist.")
    findings: List[PolicyFinding] = Field(default_factory=list, description="Policy violations or info findings.")


class PolicyFleetComplianceReport(BaseModel):
    summary: str = Field(description="A comprehensive markdown summary/report explaining which devices are compatible/non-compatible, what policies they violate, and recommended remediation steps.")
    devices: List[PolicyComplianceReport] = Field(description="List of compliance reports for each device found in the inventory.")

