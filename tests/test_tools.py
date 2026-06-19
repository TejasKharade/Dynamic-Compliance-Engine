from src.agent.tools.device_analysis_tool import analyze_device
from src.agent.tools.component_tool import query_component_context
from src.agent.tools.portfolio_analysis_tool import portfolio_risk_analysis
from src.agent.tools.change_planning_tool import simulate_change


print("\n===== TEST 14 =====")
result = analyze_device.invoke(
    {"device_id": "PRECISION-TEST-002"}
)
print(result)

print("\n===== TEST 15 =====")
result = query_component_context.invoke(
    {"component": "BIOS 3.0.0"}
)
print(result)

print("\n===== TEST 16 =====")
result = portfolio_risk_analysis.invoke({})
print(result)

print("\n===== TEST 17 =====")
result = simulate_change.invoke(
    {
        "component": "BIOS 3.0.0",
        "target_version": "2.0.0",
    }
)
print(result)