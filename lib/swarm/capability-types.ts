/**
 * capability-types.ts — Dynamic Model Capability Registry Types
 *
 * The orchestrator uses these types to score and route tasks to the best
 * available model based on task requirements, model strengths, budget
 * constraints, and real-time availability.
 *
 * Design principles (from MetaGPT study):
 * 1. Score-based routing, not name-based — never hardcode `if model == "X"`
 * 2. Capability probing on registration — new models auto-populate scores
 * 3. Graceful degradation — unknown models route by tier; add evaluation later
 * 4. Self-improving — log (model, task, success) tuples for online learning
 * 5. Provider-agnostic — candidateId is stable; model strings change across versions
 */

// ─── Task Dimensions ───────────────────────────────────────────────────────
// These are the axes along which models are scored for coding tasks.
// Each dimension is scored 0..10 where 10 = best-in-class.

export const TASK_DIMENSIONS = [
  'code_generation',
  'bug_fixing',
  'agentic_execution',
  'architecture_reasoning',
  'algorithmic_math',
  'large_codebase_nav',
  'code_review',
  'test_generation',
  'documentation',
  'frontend_ui',
  'computer_use',
  'multilingual_code',
  'security_analysis',
  'fast_simple_tasks',
] as const;

export type TaskDimension = (typeof TASK_DIMENSIONS)[number];

/** Task dimension scores — each model carries one of these */
export type TaskScores = Record<TaskDimension, number>;

// ─── Task Types (What the orchestrator routes) ──────────────────────────────

export type CodingTaskType =
  | 'code_generation'
  | 'bug_fixing'
  | 'agentic_execution'
  | 'architecture_design'
  | 'algorithmic_problem'
  | 'large_codebase_refactor'
  | 'code_review'
  | 'test_generation'
  | 'documentation'
  | 'frontend_ui'
  | 'computer_use'
  | 'multilingual_code'
  | 'security_audit'
  | 'simple_transform';

/** Maps task types to primary + secondary scoring dimensions */
export const TASK_DIMENSION_MAP: Record<CodingTaskType, { primary: TaskDimension; secondary: TaskDimension[] }> = {
  code_generation: { primary: 'code_generation', secondary: ['architecture_reasoning', 'multilingual_code'] },
  bug_fixing: { primary: 'bug_fixing', secondary: ['code_review', 'agentic_execution'] },
  agentic_execution: { primary: 'agentic_execution', secondary: ['code_generation', 'security_analysis'] },
  architecture_design: { primary: 'architecture_reasoning', secondary: ['code_review', 'large_codebase_nav'] },
  algorithmic_problem: { primary: 'algorithmic_math', secondary: ['code_generation'] },
  large_codebase_refactor: { primary: 'large_codebase_nav', secondary: ['code_generation', 'architecture_reasoning'] },
  code_review: { primary: 'code_review', secondary: ['bug_fixing', 'security_analysis'] },
  test_generation: { primary: 'test_generation', secondary: ['code_generation', 'bug_fixing'] },
  documentation: { primary: 'documentation', secondary: ['architecture_reasoning'] },
  frontend_ui: { primary: 'frontend_ui', secondary: ['code_generation'] },
  computer_use: { primary: 'computer_use', secondary: ['agentic_execution'] },
  multilingual_code: { primary: 'multilingual_code', secondary: ['code_generation'] },
  security_audit: { primary: 'security_analysis', secondary: ['code_review', 'bug_fixing'] },
  simple_transform: { primary: 'fast_simple_tasks', secondary: [] },
};

// ─── Model Tiers ────────────────────────────────────────────────────────────

export type ModelTier = 'nano' | 'mid' | 'frontier' | 'reasoning';

export const TIER_COST_CEILINGS: Record<ModelTier, number> = {
  nano: 0.50,
  mid: 3.00,
  frontier: 15.00,
  reasoning: 999.00,
};

/** Maps task complexity to minimum required tier */
export const COMPLEXITY_TIER_MAP: Record<number, ModelTier> = {
  0: 'nano',      // trivial tasks — use cheapest
  1: 'mid',       // standard tasks — balanced models
  2: 'frontier',  // complex tasks — best available
};

// ─── Model Capability Profile ───────────────────────────────────────────────

export interface ModelPricing {
  inputPerMTokens: number;
  outputPerMTokens: number;
  hasFreeQuota?: boolean;
}

export interface ModelSLO {
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  tokensPerSecond: number | null;
}

export interface ModelBenchmarks {
  swebench_verified: number | null;
  swebench_pro: number | null;
  terminal_bench_2: number | null;
  livecodebench_elo: number | null;
  humaneval: number | null;
  arc_agi_2: number | null;
  osworld_verified: number | null;
  aime: number | null;
  gpqa_diamond: number | null;
  webdev_arena_elo: number | null;
  [key: string]: number | null;    // extensible for future benchmarks
}

export interface ModelCapabilityProfile {
  // Identity
  candidateId: string;
  provider: string;
  model: string;
  displayName: string;
  family: string;
  tier: ModelTier;
  releasedAt: string;

  // Hard constraints
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsAudio: boolean;
  supportsStreaming: boolean;
  supportsExtendedThinking: boolean;

  // Economics
  pricing: ModelPricing;

  // Benchmark scores (normalized, null = unknown)
  benchmarks: ModelBenchmarks;

  // Task-dimension scores (0..10) — the routing-critical data
  taskScores: TaskScores;

  // Qualitative metadata
  strengths: string[];
  weaknesses: string[];

  // SLO characteristics
  slo: ModelSLO;

  // Freeform
  notes?: string;
}

// ─── Capability Registry ────────────────────────────────────────────────────

export interface CapabilityRegistry {
  version: number;
  updatedAt: string;
  description: string;
  taskDimensions: TaskDimension[];
  tiers: Record<ModelTier, { maxCostInputPerMToken: number; description: string }>;
  models: ModelCapabilityProfile[];
}

// ─── Task Routing ───────────────────────────────────────────────────────────

export interface TaskRoutingRequest {
  taskType: CodingTaskType;
  estimatedComplexity: 0 | 1 | 2;
  contextSizeTokens?: number;
  requiresTools?: boolean;
  requiresVision?: boolean;
  requiresExtendedThinking?: boolean;
  budgetCeilingUsd?: number | null;
  latencyBudgetMs?: number | null;
  preferredProvider?: string;
  preferredModel?: string;
  excludeProviders?: string[];
  excludeModels?: string[];
}

export interface TaskRoutingResult {
  selectedModel: ModelCapabilityProfile;
  score: number;
  reasoning: string;
  fallbackChain: Array<{ model: ModelCapabilityProfile; score: number }>;
  filtersApplied: string[];
  timerMs?: number;
}

// ─── Routing Feedback (for self-improving loop) ─────────────────────────────

export interface RoutingFeedback {
  routingRequestId: string;
  candidateId: string;
  taskType: CodingTaskType;
  complexity: number;
  success: boolean;
  durationMs: number;
  tokenUsage: { input: number; output: number };
  costUsd: number;
  qualitySignal?: 'pass' | 'fail' | 'partial';
  timestamp: string;
}

// ─── Orchestrator Role Mapping ──────────────────────────────────────────────
// Maps swarm agent roles to their primary task types for auto-routing.

export const ROLE_TASK_MAPPING: Record<string, CodingTaskType[]> = {
  research: ['large_codebase_refactor', 'documentation', 'architecture_design'],
  worker1: ['code_generation', 'agentic_execution', 'bug_fixing'],
  worker2: ['code_review', 'security_audit', 'bug_fixing'],
  evaluator: ['code_review', 'test_generation', 'architecture_design'],
  coordinator: ['architecture_design', 'code_review'],
};

// ─── IDE/Platform Registry ──────────────────────────────────────────────────
// Tracks what IDEs/platforms are available and what providers they support.

export interface IDEPlatform {
  id: string;
  name: string;
  supportedProviders: string[];
  capabilities: {
    canExecuteShell: boolean;
    canEditFiles: boolean;
    canReadFiles: boolean;
    canSearchFiles: boolean;
    hasGUI: boolean;
    hasTerminal: boolean;
  };
}

// ─── Dynamic Agent Assignment ───────────────────────────────────────────────
// Instead of hardcoding "Codex in Roo Code does X", the orchestrator
// dynamically assigns work units to available agents based on capability match.

export interface WorkUnit {
  id: string;
  description: string;
  taskType: CodingTaskType;
  complexity: 0 | 1 | 2;
  targetFiles: string[];
  dependsOn: string[];        // IDs of other work units
  requiredCapabilities?: {
    minContextWindow?: number;
    requiresTools?: boolean;
    requiresVision?: boolean;
    requiresExtendedThinking?: boolean;
  };
  budgetCeiling?: number;
}

export interface AgentAssignment {
  workUnitId: string;
  assignedModel: ModelCapabilityProfile;
  assignedPlatform?: IDEPlatform;
  score: number;
  reasoning: string;
  fallbackModels: ModelCapabilityProfile[];
}

// ─── Scoring Functions (Pure, Deterministic) ────────────────────────────────

/**
 * Score a model for a specific task routing request.
 * Returns a number where higher = better fit.
 *
 * Scoring formula:
 *   base = taskScores[primaryDimension] * 10
 *        + sum(taskScores[secondaryDimension] * 3) for each secondary
 *   cost_factor = (1 - pricing.inputPerMTokens / maxTierCost) * 5
 *   latency_factor = slo.p50LatencyMs ? clamp((5000 - p50) / 5000, 0, 1) * 5 : 2.5
 *   availability_bonus = model.available ? 10 : -1000
 *   preference_bonus = matches preferredProvider/Model ? 15 : 0
 *   total = base + cost_factor + latency_factor + availability_bonus + preference_bonus
 */
export type ScoreFunction = (
  model: ModelCapabilityProfile,
  request: TaskRoutingRequest,
  available: boolean,
) => number;
