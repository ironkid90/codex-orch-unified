# Coordination Layer

This directory is the shared communication hub for the 4 decentralized AI agents.

## Structure

```
coordination/
├── README.md          — This file
├── status.json        — Agent status board (each agent updates own section)
├── conflicts.log      — Emergency conflict log (append-only)
└── handoffs/          — Typed handoff messages between agents
    ├── wave1-codex-*.json
    ├── wave1-gemini-*.json
    ├── wave1-chatgpt-*.json
    └── wave1-opus-*.json
```

## Rules

1. **status.json**: Each agent ONLY updates its own entry. Never modify another agent's status.
2. **handoffs/**: Write-once files. Never modify a handoff after creation. Create new files for updates.
3. **conflicts.log**: Append-only. Never delete entries.
4. All timestamps must be ISO 8601 UTC.
5. All JSON must be valid and parseable.

## Handoff Schema

```json
{
  "id": "uuid-v4",
  "timestamp": "ISO-8601",
  "from_agent": "CODEX|GEMINI|CHATGPT|OPUS",
  "to_agent": "ALL|CODEX|GEMINI|CHATGPT|OPUS",
  "artifact_type": "string",
  "summary": "human-readable description",
  "payload": {},
  "files_changed": ["list", "of", "files"]
}
```
