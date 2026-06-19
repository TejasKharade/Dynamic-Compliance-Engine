from typing import Optional, List, Literal
from pydantic import BaseModel, Field


NodeType = Literal[
    "Device",
    "BIOS",
    "OperatingSystem",
    "Driver",
    "Agent",
    "Firmware",
]

RelationshipType = Literal[
    "REQUIRES",
    "CONFLICTS_WITH",
    "COMPATIBLE_WITH",
    "RECOMMENDS",
    "WARNS_AGAINST",
]

VersionOperator = Literal[">=", "<", "==", "ANY"]

FindingSeverity = Literal["PASS", "INFO", "WARNING", "CRITICAL"]


class ComplianceNode(BaseModel):
    id: str = Field(
        description=(
            "The unique identifier for the entity. "
            "For BIOS and OperatingSystem nodes, INCLUDE the version in the id "
            "(e.g., 'BIOS 2.1.0', 'Windows 11 24H2'). "
            "For Driver, Agent, and Firmware nodes, use ONLY the base name with NO version numbers "
            "(e.g., 'Intel Chipset Driver', 'Dell Management Agent', 'Thunderbolt Docking Station'). "
            "For Device nodes, use the full device name (e.g., 'Dell Latitude 5520')."
        )
    )
    type: NodeType = Field(
        description=(
            "The category of this entity. Must be EXACTLY one of: "
            "Device, BIOS, OperatingSystem, Driver, Agent, Firmware"
        )
    )


class ComplianceRelationship(BaseModel):
    source: str = Field(
        description=(
            "The id of the source node. Must exactly match an id from the nodes list."
        )
    )
    target: str = Field(
        description=(
            "The id of the target node. Must exactly match an id from the nodes list."
        )
    )
    type: RelationshipType = Field(
        description=(
            "The compliance relationship type. Must be EXACTLY one of: "
            "REQUIRES, CONFLICTS_WITH, COMPATIBLE_WITH, RECOMMENDS, WARNS_AGAINST"
        )
    )
    min_version: Optional[str] = Field(
        None,
        description=(
            "The version number from the constraint (e.g., '10.4', '1.2.0', '5.2'). "
            "Extract only the numeric part. Return null if no specific version is mentioned."
        )
    )
    operator: VersionOperator = Field(
        "ANY",
        description=(
            "The version comparison operator. Use: "
            "'>=' for ('or later', 'or newer', 'or higher', '>='). "
            "'<' for ('below', 'less than', 'not supported on', 'below'). "
            "'==' for an exact version match. "
            "'ANY' when there is no version constraint at all."
        )
    )


class ComplianceGraphDocument(BaseModel):
    nodes: List[ComplianceNode] = Field(
        description=(
            "A complete list of ALL unique entities found in the text. "
            "Every device, BIOS version, OS version, driver, agent, and firmware "
            "mentioned must appear here as a separate node. "
            "Do NOT leave this list empty."
        )
    )
    relationships: List[ComplianceRelationship] = Field(
        description=(
            "A complete list of ALL compliance rules expressed as relationships. "
            "Every rule, requirement, conflict, recommendation, or warning in the "
            "text must be captured as a relationship between two nodes. "
            "Do NOT leave this list empty."
        )
    )

class RemediationRecommendation(BaseModel):
    component: str = Field(
        description="The component that should be changed to remediate the finding."
    )
    action: str = Field(
        description="The recommended remediation action, such as upgrade, downgrade, install, remove, or review."
    )
    target_version: Optional[str] = Field(
        None,
        description="The target version to move to, when the rule provides a concrete version."
    )
    reason: str = Field(
        description="A short explanation of why this remediation is recommended."
    )


class ComplianceFinding(BaseModel):
    rule_type: RelationshipType = Field(
        description="The graph relationship type that produced this finding."
    )
    severity: FindingSeverity = Field(
        description="How serious this finding is for the evaluated device."
    )
    source: str = Field(
        description="The source node from the compliance rule."
    )
    target: str = Field(
        description="The target node from the compliance rule."
    )
    message: str = Field(
        description="Human-readable explanation of the compliance result."
    )
    remediation: Optional[RemediationRecommendation] = Field(
        None,
        description="Recommended action to fix or improve this finding, if applicable."
    )


class DeviceComplianceReport(BaseModel):
    device_id: str = Field(
        description="The unique inventory identifier of the evaluated device."
    )
    compliance_score: int = Field(
        ge=0,
        le=100,
        description="Device compliance score from 0 to 100."
    )
    is_compliant: bool = Field(
        description="True when the device has no critical compliance findings."
    )
    findings: list[ComplianceFinding] = Field(
        default_factory=list,
        description="All findings generated while evaluating this device."
    )

class RootCauseAnalysis(BaseModel):
    device_id: str
    is_compliant: bool
    compliance_score: int

    critical_findings: list[ComplianceFinding] = Field(default_factory=list)
    warning_findings: list[ComplianceFinding] = Field(default_factory=list)

    root_causes: list[str] = Field(
        default_factory=list,
        description="Most important reasons the device is non-compliant."
    )

    recommended_actions: list[str] = Field(
        default_factory=list,
        description="High-level remediation actions."
    )

 