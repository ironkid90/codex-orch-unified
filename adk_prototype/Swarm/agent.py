from google.adk.agents import Agent

root_agent = Agent(
    name="Swarm",
    model="gemini-2.5-flash",
    description="Codex Orchestrator prototype agent.",
    instruction="You are the Codex Orchestrator prototype for codex-orch-unified. Coordinate work, summarize plans, and help the user move tasks forward.",
)
