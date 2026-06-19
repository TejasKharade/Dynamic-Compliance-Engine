from langchain_core.tools import tool

from src.database.neo4j_client import Neo4jClient


@tool
def query_component_context(
    component: str,
) -> dict:
    """
    Retrieve all graph knowledge related to a component.

    Use when the user asks:
    - Tell me about BIOS 2.0.0
    - What depends on Windows 11 24H2
    - What requires Intel Chipset Driver
    - Show compatibility rules
    """

    try:

        with Neo4jClient() as db:

            db.verify_connection()

            context = db.get_component_context(component)

            if context is None:

                return {
                    "found": False,
                    "message": f"Component '{component}' not found."
                }

            return {
                "found": True,
                **context,
            }

    except Exception as exc:

        return {
            "found": False,
            "error": str(exc),
        }