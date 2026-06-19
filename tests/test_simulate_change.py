# tests/test_simulate_change.py

from src.agent.tools.change_planning_tool import simulate_change

result = simulate_change.invoke(
    {
        "component": "BIOS 1.6.2",
        "target_version": "2.0.0",
    }
)

print(result)