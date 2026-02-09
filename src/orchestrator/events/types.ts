import type { SpanId, TaskId, RunId, TaskState, WorkspaceId } from '../core/types.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type SpanStatus = 'ok' | 'error' | 'canceled';

// ============================================================================

export interface BaseEvent {
  timestamp: number;
  eventId: string;
}

// ============================================================================

export interface SpanStartEvent extends BaseEvent {
  type: 'span:start';
  spanId: SpanId;
  parentId?: SpanId;
  name: string;
  attrs?: Record<string, unknown>;
}

export interface SpanLogEvent extends BaseEvent {
  type: 'span:log';
  spanId: SpanId;
  level: LogLevel;
  message: string;
  fields?: Record<string, unknown>;
}

export interface SpanEndEvent extends BaseEvent {
  type: 'span:end';
  spanId: SpanId;
  status: SpanStatus;
  error?: string;
  durationMs?: number;
}

// ============================================================================

export interface TaskStateChangeEvent extends BaseEvent {
  type: 'task:state';
  taskId: TaskId;
  runId: RunId;
  workspaceId: WorkspaceId;
  previousState: TaskState;
  newState: TaskState;
  attempt?: number;
  error?: string;
}

export interface TaskOutputEvent extends BaseEvent {
  type: 'task:output';
  taskId: TaskId;
  runId: RunId;
  stream: 'stdout' | 'stderr' | 'combined';
  data: string;
}

export interface TaskRetryEvent extends BaseEvent {
  type: 'task:retry';
  taskId: TaskId;
  runId: RunId;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  reason: string;
}

export interface TaskQuestionEvent extends BaseEvent {
  type: 'task:question';
  taskId: TaskId;
  runId: RunId;
  question: string;
  sessionId: string;
}

// ============================================================================

export interface SchedulerStartEvent extends BaseEvent {
  type: 'scheduler:start';
  planId: string;
  totalTasks: number;
  workspaces: string[];
}

export interface SchedulerCompleteEvent extends BaseEvent {
  type: 'scheduler:complete';
  planId: string;
  succeeded: number;
  failed: number;
  canceled: number;
  skipped: number;
  durationMs: number;
}

export interface SchedulerQueueEvent extends BaseEvent {
  type: 'scheduler:queue';
  taskId: TaskId;
  queueSize: number;
  runningCount: number;
}

// ============================================================================

export type OrchestratorEvent =
  | SpanStartEvent
  | SpanLogEvent
  | SpanEndEvent
  | TaskStateChangeEvent
  | TaskOutputEvent
  | TaskRetryEvent
  | TaskQuestionEvent
  | SchedulerStartEvent
  | SchedulerCompleteEvent
  | SchedulerQueueEvent;
