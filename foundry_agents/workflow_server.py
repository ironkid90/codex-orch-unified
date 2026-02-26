"""Multi-agent workflow scaffold using Microsoft Agent Framework.

Default mode runs as an HTTP server via azure-ai-agentserver.
Use --cli to run a single local workflow pass in terminal mode.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from agent_framework import (
    AgentRunResponseUpdate,
    AgentRunUpdateEvent,
    ChatAgent,
    ChatMessage,
    Executor,
    ExecutorFailedEvent,
    Role,
    TextContent,
    WorkflowBuilder,
    WorkflowContext,
    WorkflowFailedEvent,
    WorkflowOutputEvent,
    WorkflowStatusEvent,
    handler,
)
from agent_framework.azure import AzureAIClient
from azure.ai.agentserver.agentframework import from_agent_framework
from azure.identity.aio import DefaultAzureCredential
from dotenv import load_dotenv

DEFAULT_ARTIFACT_FILE = Path("batch/out/merged_output.jsonl")
DEFAULT_MAX_ARTIFACT_CHARS = 5000

ROLE_PROMPTS: list[tuple[str, str, str]] = [
    (
        "product-manager",
        "ProductManagerAgent",
        "You are Product Manager. Produce clear scope, user outcomes, and acceptance criteria.",
    ),
    (
        "architect",
        "ArchitectAgent",
        "You are Architect. Design practical modules, interfaces, and constraints.",
    ),
    (
        "project-manager",
        "ProjectManagerAgent",
        "You are Project Manager. Break down delivery into milestones and ordered tasks.",
    ),
    (
        "engineer",
        "EngineerAgent",
        "You are Engineer. Generate implementation-ready changes and test plan.",
    ),
    (
        "qa",
        "QAAgent",
        "You are QA. Identify edge cases, risks, regressions, and release blockers.",
    ),
]


def _safe_json_loads(raw: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _extract_output_text(body: dict[str, Any]) -> str:
    output_text = body.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    response_chunks: list[str] = []
    for item in body.get("output", []):
        if isinstance(item, dict):
            item_text = item.get("text")
            if isinstance(item_text, str) and item_text.strip():
                response_chunks.append(item_text.strip())
            for content in item.get("content", []):
                if isinstance(content, dict):
                    text_value = content.get("text")
                    if isinstance(text_value, str) and text_value.strip():
                        response_chunks.append(text_value.strip())
    if response_chunks:
        return "\n".join(response_chunks)

    choices = body.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            message = first.get("message")
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, str) and content.strip():
                    return content.strip()
    return ""


def _role_from_custom_id(custom_id: str) -> str:
    parts = [part.strip() for part in custom_id.split("|") if part.strip()]
    return parts[2] if len(parts) > 2 else "unknown"


def load_batch_artifact_context(artifact_file: Path, max_chars: int) -> str:
    if not artifact_file.exists():
        return ""

    role_entries: dict[str, list[tuple[str, str]]] = {}
    rejected = 0
    parsed_count = 0

    for raw_line in artifact_file.read_text(encoding="utf-8").splitlines():
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        parsed = _safe_json_loads(raw_line)
        if not parsed:
            rejected += 1
            continue

        custom_id = parsed.get("custom_id")
        if not isinstance(custom_id, str) or not custom_id:
            rejected += 1
            continue

        if parsed.get("error"):
            rejected += 1
            continue

        response = parsed.get("response")
        if not isinstance(response, dict):
            rejected += 1
            continue

        status_code = int(response.get("status_code", 0))
        if status_code >= 400:
            rejected += 1
            continue

        body = response.get("body")
        if not isinstance(body, dict):
            rejected += 1
            continue

        text = _extract_output_text(body)
        if not text:
            rejected += 1
            continue

        role = _role_from_custom_id(custom_id)
        role_entries.setdefault(role, []).append((custom_id, text))
        parsed_count += 1

    if parsed_count == 0:
        return ""

    lines = [
        f"BATCH_SOURCE: {artifact_file.as_posix()}",
        f"ARTIFACT_COUNT: {parsed_count}",
        f"REJECTED_LINES: {rejected}",
    ]
    ordered_roles = ["ProductManager", "Architect", "ProjectManager", "Engineer", "QA"]
    seen = set()
    for role in ordered_roles + sorted(role_entries.keys()):
        if role in seen or role not in role_entries:
            continue
        seen.add(role)
        custom_id, text = role_entries[role][-1]
        lines.append("")
        lines.append(f"--- {role.upper()} ({custom_id}) ---")
        lines.append(text)

    context = "\n".join(lines)
    if len(context) > max_chars:
        return f"{context[:max_chars]}\n... [truncated]"
    return context


def _message_text(message: Any) -> str:
    text_value = getattr(message, "text", None)
    if isinstance(text_value, str) and text_value.strip():
        return text_value.strip()

    chunks: list[str] = []
    contents = getattr(message, "contents", None)
    if isinstance(contents, list):
        for part in contents:
            part_text = getattr(part, "text", None)
            if isinstance(part_text, str) and part_text.strip():
                chunks.append(part_text.strip())
    return "\n".join(chunks).strip()


def _extract_agent_response_text(response: Any) -> str:
    text_value = getattr(response, "text", None)
    if isinstance(text_value, str) and text_value.strip():
        return text_value.strip()

    messages = getattr(response, "messages", None)
    if isinstance(messages, list):
        for message in reversed(messages):
            role = getattr(message, "role", None)
            if role == Role.ASSISTANT or str(role).lower().endswith("assistant"):
                message_text = _message_text(message)
                if message_text:
                    return message_text
        for message in reversed(messages):
            message_text = _message_text(message)
            if message_text:
                return message_text
    return "No model output generated."


@dataclass
class RoleConfig:
    executor_id: str
    agent_name: str
    instructions: str
    terminal: bool = False


class RoleExecutor(Executor):
    def __init__(
        self,
        client: AzureAIClient,
        model_deployment: str,
        config: RoleConfig,
        shared_context: str,
    ) -> None:
        super().__init__(id=config.executor_id)
        self._client = client
        self._model_deployment = model_deployment
        self._config = config
        self._shared_context = shared_context
        self._agent: ChatAgent | None = None

    async def _ensure_agent(self) -> ChatAgent:
        if self._agent is not None:
            return self._agent

        instruction_text = self._config.instructions
        if self._shared_context:
            instruction_text = (
                f"{instruction_text}\n\n"
                "Use the batch artifact context as upstream source-of-truth for PRD/design context:\n"
                f"{self._shared_context}"
            )

        kwargs: dict[str, Any] = {
            "name": self._config.agent_name,
            "instructions": instruction_text,
        }
        if self._model_deployment:
            kwargs["model"] = self._model_deployment

        try:
            self._agent = self._client.create_agent(**kwargs)
        except TypeError:
            kwargs.pop("model", None)
            self._agent = self._client.create_agent(**kwargs)
        return self._agent

    @handler
    async def run_role(
        self,
        messages: list[ChatMessage],
        ctx: WorkflowContext[list[ChatMessage], str],
    ) -> None:
        agent = await self._ensure_agent()
        response = await agent.run(messages)
        new_messages = list(messages)
        response_messages = getattr(response, "messages", None)
        if isinstance(response_messages, list):
            new_messages.extend(response_messages)

        if self._config.terminal:
            output_text = _extract_agent_response_text(response)
            await ctx.yield_output(output_text)
            await ctx.add_event(
                AgentRunUpdateEvent(
                    self.id,
                    data=AgentRunResponseUpdate(
                        contents=[TextContent(text=output_text)],
                        role=Role.ASSISTANT,
                        response_id=str(uuid4()),
                    ),
                )
            )
            return

        await ctx.send_message(new_messages)


def _build_client(endpoint: str) -> AzureAIClient:
    credential = DefaultAzureCredential()
    if endpoint:
        try:
            return AzureAIClient(project_endpoint=endpoint, credential=credential)
        except TypeError:
            return AzureAIClient(endpoint=endpoint, credential=credential)
    return AzureAIClient(credential=credential)


def build_workflow(
    endpoint: str,
    model_deployment: str,
    batch_context: str,
):
    client = _build_client(endpoint)
    configs = [
        RoleConfig(*ROLE_PROMPTS[0]),
        RoleConfig(*ROLE_PROMPTS[1]),
        RoleConfig(*ROLE_PROMPTS[2]),
        RoleConfig(*ROLE_PROMPTS[3]),
        RoleConfig(*ROLE_PROMPTS[4], terminal=True),
    ]
    executors = [RoleExecutor(client, model_deployment, cfg, batch_context) for cfg in configs]

    builder = WorkflowBuilder().set_start_executor(executors[0])
    for left, right in zip(executors, executors[1:]):
        builder = builder.add_edge(left, right)
    return builder.build()


def _make_initial_messages(prompt: str) -> list[ChatMessage]:
    return [ChatMessage(role=Role.USER, text=prompt)]


async def run_cli(workflow, prompt: str) -> None:
    async for event in workflow.run_stream(_make_initial_messages(prompt)):
        if isinstance(event, WorkflowOutputEvent):
            print(f"\nOutput:\n{event.data}\n")
        elif isinstance(event, WorkflowStatusEvent):
            print(f"State: {event.state}")
        elif isinstance(event, (ExecutorFailedEvent, WorkflowFailedEvent)):
            details = getattr(event, "details", None)
            message = getattr(details, "message", "Unknown failure")
            print(f"Failure: {message}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Microsoft Agent Framework workflow.")
    parser.add_argument(
        "--cli",
        action="store_true",
        help="Run one workflow pass in terminal mode instead of HTTP server mode.",
    )
    parser.add_argument(
        "--prompt",
        default="Create an implementation plan for integrating merged batch artifacts into a swarm runtime.",
        help="User prompt for --cli mode.",
    )
    parser.add_argument(
        "--artifact-file",
        default=os.getenv("SWARM_BATCH_MERGED_FILE", str(DEFAULT_ARTIFACT_FILE)),
        help="Merged batch artifact file used as shared multi-agent context.",
    )
    parser.add_argument(
        "--max-artifact-chars",
        type=int,
        default=DEFAULT_MAX_ARTIFACT_CHARS,
        help="Maximum merged artifact context characters injected into role instructions.",
    )
    return parser.parse_args()


async def async_main() -> None:
    load_dotenv(override=True)
    args = parse_args()

    endpoint = os.getenv("FOUNDRY_PROJECT_ENDPOINT", "").strip()
    model_deployment = os.getenv("FOUNDRY_MODEL_DEPLOYMENT_NAME", "").strip()
    artifact_file = Path(args.artifact_file)
    batch_context = load_batch_artifact_context(artifact_file, max(1000, args.max_artifact_chars))

    workflow = build_workflow(endpoint, model_deployment, batch_context)
    if args.cli:
        await run_cli(workflow, args.prompt)
        return

    agent = workflow.as_agent()
    await from_agent_framework(agent).run_async()


if __name__ == "__main__":
    asyncio.run(async_main())
