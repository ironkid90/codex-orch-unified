---
tracker:
  kind: github
  api_key: ${GITHUB_TOKEN}
  endpoint: https://api.github.com
  repository: Admin/codex-orch-unified
  active_states:
    - open
  terminal_states:
    - closed

polling:
  interval_ms: 60000

workspace:
  root: ${SWARM_WORKSPACE_ROOT:-.}
  directory: .swarm-workspaces

hooks:
  after_create: |
    npm install --prefer-offline
  before_run: |
    echo "Preparing ${ISSUE_IDENTIFIER} in ${WORKSPACE_PATH}"
  after_run: |
    npm run typecheck
  before_remove: |
    echo "Removing isolated workspace ${WORKSPACE_PATH}"
  timeout_ms: 120000

agent:
  max_concurrent_agents: 3
  max_turns: 6
  max_retry_backoff_ms: 300000
  max_concurrent_agents_by_state:
    open: 2
    in_progress: 1

codex:
  command: codex app-server
  approval_policy: on-request
  thread_sandbox: workspace-write
  turn_sandbox_policy: workspace-write
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000

delegation:
  enabled: true
  default_mode: architect
  modes:
    architect: Plan the work, select the right specialist mode, and keep the global context coherent.
    code: Implement the smallest correct change, then verify it.
    debug: Reproduce failures, isolate root cause, and document the fix path.
    review: Audit for regressions, missing tests, and unsafe assumptions.

skills:
  enabled: true
  directories:
    - ${CODEX_HOME}/skills
    - ${HOME}/.codex/skills
  required:
    - software-architecture
    - lint-and-validate

todo:
  enabled: true
  file_name: TODO.md
  max_items: 24
---

You are working from the repository-owned workflow contract.

Required operating rules:
- Use the tracker payload as the source of truth for issue id, identifier, title, state, labels, blockers, and links.
- Stay inside the isolated issue workspace. Never write outside `${WORKSPACE_PATH}` unless the workflow explicitly authorizes it.
- Use Kilo-style delegation deliberately: choose `architect`, `code`, `debug`, or `review` mode before starting a subtask.
- Load only the minimum skills required for the current step. Do not bulk-load the whole skill catalog.
- Keep a living todo list in `${WORKSPACE_PATH}/${TODO_FILE}`. Update it before and after each meaningful action.
- Report token usage and verification results in the final round summary.

Issue context:
- Identifier: `{{ issue.identifier }}`
- Title: `{{ issue.title }}`
- State: `{{ issue.state }}`
- Priority: `{{ issue.priority | default: "unset" }}`
- Labels: `{{ issue.labels | default: [] }}`
- Blockers: `{{ issue.blockedBy | default: [] }}`
- URL: `{{ issue.url | default: "n/a" }}`

Retry context:
- Attempt: `{{ attempt | default: 1 }}`
- Previous error: `{{ retry.error | default: "none" }}`

Execution contract:
1. Summarize the problem and create/update the todo list.
2. Select the appropriate delegation mode for the next step.
3. Implement the smallest correct change.
4. Run the tightest relevant verification.
5. Leave a concise summary with changed files, remaining risks, and token usage.
