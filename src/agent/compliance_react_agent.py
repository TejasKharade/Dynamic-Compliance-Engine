from __future__ import annotations

from functools import lru_cache
from typing import Annotated, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from src.agent.tools.change_planning_tool import simulate_change
from src.agent.tools.component_tool import query_component_context
from src.agent.tools.device_analysis_tool import analyze_device
from src.agent.tools.portfolio_analysis_tool import portfolio_risk_analysis
from src.agent.tools.report_tool import get_device_report


TOOLS = [
    get_device_report,
    analyze_device,
    query_component_context,
    simulate_change,
    portfolio_risk_analysis,
]

SYSTEM_PROMPT = """
You are an enterprise endpoint compatibility copilot.

You help administrators understand:
- device compliance status
- root causes of failures
- graph-based compatibility rules
- impact of proposed changes
- fleet-wide risk and remediation priorities

Important behavior:
- Use the minimum number of tools needed to answer well.
- Prefer one tool when one tool is enough.
- Use multiple tools only when the user explicitly asks for combined reasoning.
- Users may refer to a device by a partial ID, short ID, or descriptive label.
- Still use the device tools even if the query is not an exact stored device id.
- Do not refuse because the name looks incomplete.
- Let the tools resolve the best matching report or graph node.
- Never invent compliance findings or graph rules.
- Give concise, executive-friendly answers with the key conclusion first.

Tool usage policy:
- Use get_device_report for a single device's compliance status.
- Use analyze_device for why a device failed and what to fix first.
- Use query_component_context for questions about a component, BIOS, OS, driver, agent, or firmware.
- Use simulate_change for "what if I upgrade/change X?" questions.
- Use portfolio_risk_analysis for fleet-wide priority and risk questions.
"""


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


_llm = ChatOpenAI(
    model="gpt-4.1-mini",
    temperature=0,
)
_tool_llm = _llm.bind_tools(TOOLS)


def _agent_node(state: AgentState) -> dict:
    messages = [SystemMessage(content=SYSTEM_PROMPT), *state["messages"]]
    response = _tool_llm.invoke(messages)
    return {"messages": [response]}


def _should_continue(state: AgentState) -> str:
    last_message = state["messages"][-1]
    tool_calls = getattr(last_message, "tool_calls", None)
    if tool_calls:
        return "tools"
    return END


@lru_cache(maxsize=1)
def get_agent_graph():
    graph = StateGraph(AgentState)

    graph.add_node("agent", _agent_node)
    graph.add_node("tools", ToolNode(TOOLS))

    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", _should_continue, {"tools": "tools", END: END})
    graph.add_edge("tools", "agent")

    return graph.compile(checkpointer=MemorySaver())

def _extract_current_turn_tool_names(messages: list[BaseMessage]) -> list[str]:
    """
    Return only the tools used for the latest user turn,
    not the full session history.
    """
    last_human_idx = -1
    for i, msg in enumerate(messages):
        if isinstance(msg, HumanMessage):
            last_human_idx = i

    if last_human_idx == -1:
        return []

    tool_names: list[str] = []
    seen: set[str] = set()

    for msg in messages[last_human_idx + 1 :]:
        tool_calls = getattr(msg, "tool_calls", None) or []
        for call in tool_calls:
            name = call.get("name") if isinstance(call, dict) else None
            if name and name not in seen:
                seen.add(name)
                tool_names.append(name)

    return tool_names


def _extract_current_turn_answer(messages: list[BaseMessage]) -> str:
    """
    Return the final AI answer from the latest user turn only.
    """
    last_human_idx = -1
    for i, msg in enumerate(messages):
        if isinstance(msg, HumanMessage):
            last_human_idx = i

    search_space = messages[last_human_idx + 1 :] if last_human_idx >= 0 else messages

    for msg in reversed(search_space):
        if isinstance(msg, AIMessage) and msg.content:
            return msg.content

    return ""

def _extract_tool_names(messages: list[BaseMessage]) -> list[str]:
    tool_names: list[str] = []
    seen: set[str] = set()

    for message in messages:
        tool_calls = getattr(message, "tool_calls", None) or []
        for call in tool_calls:
            name = call.get("name")
            if name and name not in seen:
                seen.add(name)
                tool_names.append(name)

    return tool_names


def ask_agent(question: str, session_id: str = "default") -> dict:
    app = get_agent_graph()

    result = app.invoke(
        {"messages": [HumanMessage(content=question)]},
        config={"configurable": {"thread_id": session_id}},
    )

    messages = result["messages"]

    return {
        "session_id": session_id,
        "answer": _extract_current_turn_answer(messages),
        "tools_used": _extract_current_turn_tool_names(messages),
    }