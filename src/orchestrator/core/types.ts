/**
 * Core domain types for the orchestration engine
 */

// ============================================================================
// Identifiers
// ============================================================================

export type WorkspaceId = string;
export type TaskId = string;
export type RunId = string;
export type SpanId = string;

// ============================================================================
// Workspace
// ============================================================================

export interface Workspace {
  id: WorkspaceId;
  name: string;
  rootPath: string;
  /** Max concurrent tasks in this workspace (default: unlimited) */
  concurrency?: number;
  /** Environment variables for all tasks in this workspace */
  env?: Record<string, string>;
}

// ============================================================================
// Task Specification (immutable definition)
// ============================================================================

export type ActionType = 'shell' | 'claude-agent' | 'custom';

export interface ShellAction {
  type: 'shell';
  command: string;
  args?: string[];
  shell?: boolean;
}

export interface ClaudeAgentAction {
  type: 'claude-agent';
  prompt: string;
  maxTurns?: number;
  allowedTools?: string[];
}

export interface CustomAction {
  type: 'custom';
  handler: string; // Reference to registered handler
  params?: Record<string, unknown>;
}

export type TaskAction = ShellAction | ClaudeAgentAction | CustomAction;

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[]; // Error patterns to retry on
}

export interface TaskSpec {
  id: TaskId;
  workspaceId: WorkspaceId;
  name: string;
  description?: string;
  deps: TaskId[];
  action: TaskAction;
  env?: Record<string, string>;
  timeoutMs?: number;
  retry?: RetryPolicy;
  /** Resource requirements (for future scheduling) */
  resources?: {
    cpu?: number;
    memory?: number;
  };
  /** Tags for filtering/grouping */
  tags?: string[];
  /** If true, failure doesn't fail dependents (they're skipped instead) */
  allowFailure?: boolean;
}

// ============================================================================
// Task State Machine
// ============================================================================

export type TaskState =
  | 'pending'    // Waiting for dependencies
  | 'queued'     // Dependencies met, waiting for execution slot
  | 'running'    // Currently executing
  | 'succeeded'  // Completed successfully
  | 'failed'     // Completed with error
  | 'canceled'   // Canceled by user or upstream failure
  | 'skipped';   // Skipped due to upstream allowFailure

/** Valid state transitions */
export const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  pending: ['queued', 'canceled', 'skipped'],
  queued: ['running', 'canceled', 'skipped'],
  running: ['succeeded', 'failed', 'canceled'],
  succeeded: [], // Terminal
  failed: ['queued'], // Can retry -> queued
  canceled: [], // Terminal
  skipped: [], // Terminal
};

export function isTerminalState(state: TaskState): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'canceled' || state === 'skipped';
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// ============================================================================
// Task Run (mutable execution state)
// ============================================================================

export interface ExitResult {
  code: number;
  signal?: string;
  stdout?: string;
  stderr?: string;
  output?: string; // Combined or structured output
  error?: Error;
  durationMs: number;
}

export interface TaskRun {
  runId: RunId;
  specId: TaskId;
  state: TaskState;
  attempt: number;
  queuedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  result?: ExitResult;
  error?: string;
  /** Parent span ID for observability */
  spanId?: SpanId;
}

// ============================================================================
// Execution Plan (DAG)
// ============================================================================

export interface ExecutionPlan {
  id: string;
  workspaces: Map<WorkspaceId, Workspace>;
  tasks: Map<TaskId, TaskSpec>;
  /** Adjacency list: task -> tasks that depend on it */
  dependents: Map<TaskId, Set<TaskId>>;
  /** Reverse: task -> tasks it depends on */
  dependencies: Map<TaskId, Set<TaskId>>;
  /** In-degree count for each task */
  indegree: Map<TaskId, number>;
  /** Tasks with no dependencies (entry points) */
  roots: Set<TaskId>;
  createdAt: number;
}

// ============================================================================
// Scheduler Configuration
// ============================================================================

export interface SchedulerConfig {
  /** Global max concurrent tasks (default: unlimited) */
  globalConcurrency?: number;
  /** Per-workspace concurrency limits (overrides workspace.concurrency) */
  workspaceConcurrency?: Record<WorkspaceId, number>;
  /** Default timeout for tasks without explicit timeout */
  defaultTimeoutMs: number;
  /** Default retry policy */
  defaultRetry: RetryPolicy;
  /** Whether to cancel dependents on failure (vs skip) */
  cancelOnFailure: boolean;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  globalConcurrency: Infinity, // No limit by default
  defaultTimeoutMs: 3_00_000, // 5 minutes
  defaultRetry: {
    maxAttempts: 1,
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
    backoffMultiplier: 2,
  },
  cancelOnFailure: true,
};
