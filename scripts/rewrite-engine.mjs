import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'lib', 'swarm', 'engine.ts');
let content = fs.readFileSync(file, 'utf8');

if (!content.includes('GraphExecutor')) {
  content = content.replace(
    'import { McpClientManager, createMcpToolWrappers } from "./mcp-client";',
    'import { McpClientManager, createMcpToolWrappers } from "./mcp-client";\nimport { GraphExecutor } from "./graph-executor";\nimport type { WorkflowGraph } from "./graph-types";'
  );
}

const startMatch = 'async function runSwarm(opts: { maxRounds: number; workspace: string; mode: RunMode }): Promise<void> {';
const endMatch = 'export function getActiveRunPromise(): Promise<void> | null {';
const startIdx = content.indexOf(startMatch);
const endIdx = content.indexOf(endMatch);

if (startIdx !== -1 && endIdx !== -1) {
  const replacement = `async function runSwarm(opts: { maxRounds: number; workspace: string; mode: RunMode }): Promise<void> {
  await mkdir(RUNS_DIR, { recursive: true });
  await configureRunToolRegistry(opts.workspace);
  let prevFeedback = "";
  let prevCoordinatorContext: CoordinatorContinuityContext | null = null;
  let carryW1Directives: string[] = [];
  let carryW2Directives: string[] = [];
  let carryCoordinatorRules: string[] = [];
  let carryNextActions: string[] = [];
  const routingConfig = await loadRoutingConfig(opts.workspace);
  const roleExecutions = Object.fromEntries(
    AGENT_IDS.map((agentId) => [agentId, resolveRoleExecution(agentId, routingConfig)]),
  ) as Record<AgentId, RoleExecutionPreference>;
  swarmStore.appendEvent({
    type: "context.model_routing",
    round: 0,
    message: summarizeRouting(routingConfig, AGENT_IDS),
    metadata: {
      hasRoutingConfig: Boolean(routingConfig?.assignments),
      source: routingConfig?.source || process.env.SWARM_MODEL_ROUTING_FILE || "config/model-routing.json",
    },
  });
  const batchArtifacts = await loadBatchArtifactContext(opts.workspace);
  if (batchArtifacts.text) {
    swarmStore.appendEvent({
      type: "context.batch_artifacts",
      round: 0,
      message: \`Loaded \${batchArtifacts.artifactCount} merged batch artifacts.\`,
      metadata: {
        source: batchArtifacts.sourceFile || "",
        rejectedCount: batchArtifacts.rejectedCount,
      },
    });
  }

  const features = swarmStore.getState().features;

  const graph: WorkflowGraph = {
    id: "swarm-default",
    nodes: [
      { id: "research", type: "agent", agentRole: "research" },
      { id: "worker1", type: "agent", agentRole: "worker1" },
      { id: "worker2", type: "agent", agentRole: "worker2" },
      { id: "evaluator", type: "agent", agentRole: "evaluator" },
      { id: "merge1", type: "merge" },
      { id: "coordinator", type: "agent", agentRole: "coordinator" },
    ],
    edges: [
      { id: "e1", from: "research", to: "worker1", type: "sequential" },
      { id: "e2", from: "worker1", to: "worker2", type: "parallel" },
      { id: "e3", from: "worker1", to: "evaluator", type: "parallel" },
      { id: "e4", from: "worker2", to: "merge1", type: "sequential" },
      { id: "e5", from: "evaluator", to: "merge1", type: "sequential" },
      { id: "e6", from: "merge1", to: "coordinator", type: "sequential" },
    ],
    entryNodes: features.researchAgent ? ["research"] : ["worker1"],
    exitNodes: ["coordinator"],
  };

  let roundDir = "";
  let lint: any = { passed: true, exitCode: 0, command: "disabled", ran: false };
  let changedFiles: string[] = [];
  let worker2Skipped = false;
  let roundTokenBaseline: TokenUsage;

  const executor = new GraphExecutor(graph, {
    onRoundStart: async (round) => {
      await processQueuedControlRequests(round);
      const fsStore = swarmStore.getState().features;
      roundTokenBaseline = tokenTracker.getAggregateTotals();
      await waitIfPaused(round, "round_start");
      swarmStore.setCurrentRound(round);
      swarmStore.appendEvent({ type: "round.started", round, message: \`Round \${round} started.\` });

      roundDir = path.join(RUNS_DIR, \`round-\${round}\`);
      await mkdir(roundDir, { recursive: true });
      await writeFile(path.join(roundDir, MESSAGE_FILE), "", "utf8");

      if (fsStore.checkpointing) {
        await createCheckpoint(round, opts.workspace);
        swarmStore.appendEvent({ type: "checkpoint.created", round, message: \`Checkpoint round \${round} created.\` });
      }
    },
    executeNode: async (node, context, round) => {
      const fsStore = swarmStore.getState().features;
      const [baseW1, baseW2, baseEval, baseCoord] = await Promise.all([
        readPrompt("worker1"),
        readPrompt("worker2"),
        readPrompt("evaluator"),
        readPrompt("coordinator"),
      ]);

      const evaluatorHistorySuffix = prevFeedback
        ? \`\\n\\n--- PREVIOUS EVALUATOR FEEDBACK ---\\n\${maybeCompress(prevFeedback, fsStore.contextCompression)}\`
        : "";
      const batchArtifactSuffix = batchArtifacts.text
        ? \`\\n\\n--- BATCH ARTIFACT CONTEXT ---\\n\${maybeCompress(batchArtifacts.text, fsStore.contextCompression)}\`
        : "";
      const researchSuffix = context["research"]?.text
        ? \`\\n\\n--- RESEARCH CONTEXT ---\\n\${maybeCompress(context["research"].text, fsStore.contextCompression)}\`
        : "";

      if (node.id === "research") {
        const res = await runResearch(round, opts.workspace, opts.mode, roundDir, prevFeedback, roleExecutions.research);
        return { nodeId: node.id, status: "completed", output: res };
      }

      if (node.id === "worker1") {
        const nextActionAssignments = assignNextActions(carryNextActions);
        const worker1DirectiveSuffix = [
          formatDirectiveBlock("PREVIOUS EVALUATOR DIRECTIVES (WORKER-1 ONLY)", carryW1Directives),
          formatDirectiveBlock("PREVIOUS COORDINATOR NEXT_ACTIONS (WORKER-1 OWNERSHIP)", nextActionAssignments.worker1),
        ].join("");

        const before = fsStore.heuristicSelector || fsStore.lintLoop ? await collectFingerprints(opts.workspace) : new Map();

        const worker1 = await runAgentTask({
          agentId: "worker1",
          round,
          prompt: \`\${baseW1}\${researchSuffix}\${batchArtifactSuffix}\${worker1DirectiveSuffix}\`,
          outFile: path.join(roundDir, "worker1.md"),
          workspace: opts.workspace,
          mode: opts.mode,
          roundDir,
          target: "coordinator",
          execution: roleExecutions.worker1,
        });

        const after = fsStore.heuristicSelector || fsStore.lintLoop ? await collectFingerprints(opts.workspace) : new Map();
        changedFiles = diffFingerprints(before, after);
        swarmStore.appendEvent({
          type: "workspace.diff",
          round,
          message: \`Worker-1 changed \${changedFiles.length} tracked files.\`,
          metadata: { changedFiles: changedFiles.slice(0, 20) },
        });

        lint = fsStore.lintLoop
          ? await runLint(round, opts.workspace, roundDir, changedFiles)
          : { round, command: "disabled", ran: false, passed: true, exitCode: 0 };
        swarmStore.upsertLintResult(lint);
        swarmStore.appendEvent({
          type: "lint.finished",
          round,
          level: lint.passed ? "info" : "warn",
          message: lint.ran
            ? lint.passed
              ? "Lint loop passed."
              : \`Lint loop failed (exit \${lint.exitCode}).\`
            : lint.command,
        });

        return { nodeId: node.id, status: "completed", output: worker1 };
      }

      if (node.id === "evaluator") {
        const worker1 = context["worker1"];
        const evaluator = await runAgentTask({
          agentId: "evaluator",
          round,
          prompt: \`\${baseEval}\${evaluatorHistorySuffix}\${researchSuffix}\${batchArtifactSuffix}\${formatDirectiveBlock(
            "PREVIOUS COORDINATOR NEXT_ACTIONS",
            carryNextActions,
          )}\\n\\n--- WORKER-1 OUTPUT ---\\n\${maybeCompress(worker1?.text || "", fsStore.contextCompression)}\`,
          outFile: path.join(roundDir, "evaluator.md"),
          workspace: opts.workspace,
          mode: opts.mode,
          roundDir,
          target: "coordinator",
          execution: roleExecutions.evaluator,
        });
        return { nodeId: node.id, status: "completed", output: evaluator };
      }

      if (node.id === "worker2") {
        const worker1 = context["worker1"];
        const nextActionAssignments = assignNextActions(carryNextActions);
        const worker2DirectiveSuffix = [
          formatDirectiveBlock("PREVIOUS EVALUATOR DIRECTIVES (WORKER-2 ONLY)", carryW2Directives),
          formatDirectiveBlock("PREVIOUS COORDINATOR NEXT_ACTIONS (WORKER-2 OWNERSHIP)", nextActionAssignments.worker2),
        ].join("");

        if (fsStore.heuristicSelector && changedFiles.length === 0) {
          worker2Skipped = true;
          const outFile = path.join(roundDir, "worker2.md");
          const text = "1) COVERAGE TABLE:\\n- no tracked file changes\\n\\n2) DEFECTS:\\n- none\\n\\n3) PERFORMANCE CHECK:\\n- skipped\\n\\n4) DECISION: SKIPPED_NO_CHANGES";
          await writeFile(outFile, text, "utf8");
          swarmStore.setAgentState("worker2", {
            phase: "completed",
            round,
            startedAt: nowIso(),
            endedAt: nowIso(),
            outputFile: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
            excerpt: "Auditor skipped by selector.",
            pdaStage: "act",
            taskTarget: "coordinator",
          });
          return { nodeId: node.id, status: "completed", output: { text, outFile, sha256: hashText(text), failed: false } };
        }

        const worker2 = await runAgentTask({
          agentId: "worker2",
          round,
          prompt: \`\${baseW2}\${researchSuffix}\${batchArtifactSuffix}\${worker2DirectiveSuffix}\\n\\n--- TRACKED CHANGED FILES ---\\n\${changedFiles.length ? changedFiles.join("\\n") : "(none)"
            }\\n\\n--- WORKER-1 OUTPUT ---\\n\${maybeCompress(worker1?.text || "", fsStore.contextCompression)}\`,
          outFile: path.join(roundDir, "worker2.md"),
          workspace: opts.workspace,
          mode: opts.mode,
          roundDir,
          target: "coordinator",
          execution: roleExecutions.worker2,
        });
        return { nodeId: node.id, status: "completed", output: worker2 };
      }

      if (node.id === "coordinator") {
        const worker1 = context["worker1"];
        const worker2 = context["worker2"];
        const evaluator = context["evaluator"];
        const previousDecision = prevCoordinatorContext
          ? \`\${prevCoordinatorContext.status} (round \${prevCoordinatorContext.round}, variant \${prevCoordinatorContext.variant})\`
          : "None (start of run)";
        const continuityBlock = [
          "--- HISTORY & CONTINUITY ---",
          "Previous Round Decision:",
          previousDecision,
          "Adaptive Guidance:",
          buildAdaptiveGuidance(prevCoordinatorContext),
          "",
          formatContinuityList("Carry-over evaluator COORDINATION_RULES", carryCoordinatorRules),
          formatContinuityList("Carry-over coordinator NEXT_ACTIONS", carryNextActions),
        ].join("\\n");

        const coordinatorPrompt = \`\${baseCoord}\\n\\nRound: \${round}\\nWorkspace: \${opts.workspace}\\nLint: ran=\${lint.ran}; passed=\${lint.passed}; command=\${lint.command}; exit=\${lint.exitCode}\\nChanged files (\${changedFiles.length}):\\n\${changedFiles.length ? changedFiles.join("\\n") : "(none)"}\\n\\n\${continuityBlock}\\n\\nResearch:\\n\${context["research"] ? maybeCompress(context["research"].text, fsStore.contextCompression) : "(disabled)"}\\n\\nBatch Artifact Context:\\n\${batchArtifacts.text ? maybeCompress(batchArtifacts.text, fsStore.contextCompression) : "(none)"}\\n\\nWorker-1 Output:\\n\${maybeCompress(worker1?.text || "", fsStore.contextCompression)}\\n\\nWorker-2 Output:\\n\${maybeCompress(worker2?.text || "", fsStore.contextCompression)}\\n\\nEvaluator Output:\\n\${maybeCompress(evaluator?.text || "", fsStore.contextCompression)}\\n\`;

        const coordinator = fsStore.ensembleVoting
          ? await runCoordinatorEnsemble(round, opts.workspace, opts.mode, roundDir, coordinatorPrompt, roleExecutions.coordinator)
          : await runAgentTask({
              agentId: "coordinator",
              round,
              prompt: coordinatorPrompt,
              outFile: path.join(roundDir, "coordinator.md"),
              workspace: opts.workspace,
              mode: opts.mode,
              roundDir,
              target: "broadcast",
              execution: roleExecutions.coordinator,
            });
        return { nodeId: node.id, status: "completed", output: coordinator };
      }

      return { nodeId: node.id, status: "completed" };
    },
    onRoundEnd: async (round) => {
      return true;
    }
  });

  let lastCoordinatorResult: any;
  let lastWorker2Result: any;
  let lastEvaluatorResult: any;

  const origExecuteNode = executor["config"].executeNode;
  executor["config"].executeNode = async (node, context, round) => {
    const res = await origExecuteNode!(node, context, round);
    if (res.output) {
      if (node.id === "coordinator") lastCoordinatorResult = res.output;
      if (node.id === "worker2") lastWorker2Result = res.output;
      if (node.id === "evaluator") lastEvaluatorResult = res.output;
    }
    return res;
  };

  const origOnRoundEnd = executor["config"].onRoundEnd;
  executor["config"].onRoundEnd = async (round) => {
    const fsStore = swarmStore.getState().features;
    const coordinator = lastCoordinatorResult;
    const worker2 = lastWorker2Result;
    const evaluator = lastEvaluatorResult;

    prevFeedback = evaluator?.text || "";

    const coordStatus = parseCoordinatorStatus(coordinator?.text || "");
    const worker2Decision = parseWorker2Decision(worker2?.text || "") || (worker2Skipped ? "SKIPPED_NO_CHANGES" : undefined);
    const evalStatus = parseEvaluatorStatus(evaluator?.text || "");
    const finalStatus = deriveRoundStatus(coordStatus, worker2Decision, evalStatus, lint.passed);

    const notes: string[] = [];
    if (worker2Decision) notes.push(\`Worker-2 decision: \${worker2Decision}\`);
    if (evalStatus) notes.push(\`Evaluator status: \${evalStatus}\`);
    notes.push(\`Lint: \${lint.passed ? "PASS" : \`FAIL (\${lint.exitCode})\`}\`);
    notes.push(
      changedFiles.length === 0
        ? "Heuristic selector: no tracked file changes."
        : \`Tracked changed files: \${changedFiles.slice(0, 6).join(", ")}\`,
    );
    notes.push(...parseRisks(coordinator?.text || ""));
    let roundTokenTotals = subtractTokenUsage(tokenTracker.getAggregateTotals(), roundTokenBaseline);
    if (!roundTokenTotals) roundTokenTotals = createTokenUsage();
    notes.push(\`Tokens: \${formatTokenUsage(roundTokenTotals)}\`);

    swarmStore.upsertRound({
      round,
      status: finalStatus,
      worker2Decision,
      evaluatorStatus: evalStatus,
      coordinatorStatus: coordStatus,
      lintPassed: lint.passed,
      auditorSkipped: worker2Skipped,
      changedFiles: changedFiles.slice(0, 20),
      tokenTotals: roundTokenTotals,
      notes,
    });

    swarmStore.appendEvent({
      type: "round.finished",
      round,
      message: \`Round \${round} finished with \${finalStatus}.\`,
      metadata: { worker2Decision, evalStatus, coordStatus, lintPassed: lint.passed, roundTokenTotals, aggregateTokenTotals: tokenTracker.getAggregateTotals() },
    });

    carryW1Directives = mergeDirectiveLists(carryW1Directives, parseStructuredSection(evaluator?.text || "", "PROMPT_UPDATES_W1"), 10);
    carryW2Directives = mergeDirectiveLists(carryW2Directives, parseStructuredSection(evaluator?.text || "", "PROMPT_UPDATES_W2"), 10);
    carryCoordinatorRules = mergeDirectiveLists(carryCoordinatorRules, parseStructuredSection(evaluator?.text || "", "COORDINATION_RULES"), 10);
    carryNextActions = mergeDirectiveLists(carryNextActions, parseStructuredSection(coordinator?.text || "", "NEXT_ACTIONS"), 12);
    const selectedVariant = isEnsembleTaskResult(coordinator) ? coordinator.selectedVariant : "single";
    prevCoordinatorContext = { round, status: finalStatus, variant: selectedVariant };

    const defects = parseDefectSeverities(worker2?.text || "");
    const shouldRewind = fsStore.checkpointing && round > 1 && (coordStatus === "FAIL" || (!lint.passed && (defects.high > 0 || defects.med > 0)));
    
    if (shouldRewind) {
      const targetRound = round - 1;
      const restored = await restoreCheckpoint(targetRound, opts.workspace);
      swarmStore.appendEvent({
        type: "run.rewind",
        round,
        level: "warn",
        message: \`Auto-rewind to checkpoint round \${targetRound}.\`,
        metadata: { targetRound, restoredCount: restored },
      });
      if (fsStore.humanInLoop || fsStore.checkpointing) {
        swarmStore.setPaused(true, \`Auto-paused after rewind to round \${targetRound}.\`);
        await waitIfPaused(round, "post_rewind_review");
      }
    }

    if (finalStatus === "PASS") {
      swarmStore.finishRun("Coordinator, evaluator, and auditor reached PASS.");
      return false; // Exit loop
    }
    return true; // continue next round
  };

  await executor.execute(opts.workspace, opts.maxRounds);
  
  const sStore = swarmStore.getState();
  if (sStore.running) {
    swarmStore.finishRun("Reached max rounds; revisions still required.");
  }
}
\n`;

  const newContent = content.substring(0, startIdx) + replacement + content.substring(endIdx);
  fs.writeFileSync(file, newContent, 'utf8');
  console.log('Successfully replaced runSwarm in engine.ts');
} else {
  console.log('Could not find startMatch or endMatch in engine.ts');
  console.log('startIdx:', startIdx);
  console.log('endIdx:', endIdx);
}
