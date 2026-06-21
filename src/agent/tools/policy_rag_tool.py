from typing import Any
from dotenv import load_dotenv

load_dotenv()

from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser

# We will maintain a global reference to the FAISS store in memory
# so the LangGraph agent can query it.
_GLOBAL_POLICY_RAG_STORE = None

def set_global_policy_rag_store(vectorstore: Any):
    global _GLOBAL_POLICY_RAG_STORE
    _GLOBAL_POLICY_RAG_STORE = vectorstore

def get_global_policy_rag_store():
    return _GLOBAL_POLICY_RAG_STORE

@tool
def query_policy_rules(question: str) -> str:
    """
    Query the currently uploaded corporate policy document.
    Use this tool when the user asks about the requirements, rules, or guidelines
    specified in the compliance policy (e.g., "What are the rules for Docker Desktop?",
    "What OS versions are supported?").
    """
    store = get_global_policy_rag_store()
    if not store:
        return "No policy document has been ingested yet. Please upload a policy file first."
    
    retriever = store.as_retriever(search_kwargs={"k": 5})
    docs = retriever.invoke(question)
    context = "\n\n".join([d.page_content for d in docs])
    
    llm = ChatOpenAI(temperature=0, model_name='gpt-4o-mini')
    prompt = ChatPromptTemplate.from_template(
        "You are a helpful policy compliance assistant.\n"
        "Answer the user's question using the policy excerpts provided below.\n"
        "If the answer is not in the text, say you don't know.\n\n"
        "Policy Excerpts:\n{context}\n\n"
        "Question: {question}"
    )
    
    chain = prompt | llm | StrOutputParser()
    return chain.invoke({"context": context, "question": question})
