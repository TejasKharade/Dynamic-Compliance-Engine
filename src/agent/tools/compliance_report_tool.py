from dotenv import load_dotenv

load_dotenv()

from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from src.agent.policy_report_store import get_latest_policy_summary


@tool
def query_compliance_report(question: str) -> str:
    """
    Query or chat about the overall Policy Compliance Summary Report.
    WARNING: DO NOT USE THIS TOOL for specific devices.
    WARNING: DO NOT USE THIS TOOL for graph compatibility or neo4j.
    WARNING: DO NOT USE THIS TOOL for simulations or deployment impact.
    ONLY use this tool if the user explicitly asks for "the policy summary", "the latest compliance report", or an overview of all policy devices.
    """
    summary = get_latest_policy_summary()
    if not summary:
        return "No policy compliance report has been generated yet. Please upload policy documents and run evaluation first."

    llm = ChatOpenAI(temperature=0, model_name="gpt-4o-mini")
    prompt = ChatPromptTemplate.from_template(
        "You are a helpful policy compliance assistant.\n"
        "Answer the user's question using the latest policy compliance report summary provided below.\n\n"
        "Latest Compliance Report Summary:\n{summary}\n\n"
        "Question: {question}"
    )
    chain = prompt | llm | StrOutputParser()
    return chain.invoke({"summary": summary, "question": question})
