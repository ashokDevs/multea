import { randomUUID } from 'node:crypto';
import type { OrchestratorEvent, SpanStatus, LogLevel } from './types.js';
import type { SpanId, TaskId, RunId, TaskState, WorkspaceId } from '../core/types.js';

export type EventHandler = (event: OrchestratorEvent) => void;

export class EventBus {
  private handlers: Set<EventHandler> = new Set();
  private queue: OrchestratorEvent[] = [];
  private processing = false;
  private maxQueueSize: number;

  constructor(maxQueueSize = 10_000) {
    this.maxQueueSize = maxQueueSize;
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(event: OrchestratorEvent): void {
    // Drop events if queue is full (back-pressure)
    if (this.queue.length >= this.maxQueueSize) {
      return;
    }

    this.queue.push(event);
    this.processQueue();
  }

  private processQueue(): void {
    if (this.processing) return;
    this.processing = true;

    // Process in next tick to avoid blocking
    setImmediate(() => {
      while (this.queue.length > 0) {
        const event = this.queue.shift()!;
        for (const handler of this.handlers) {
          try {
            handler(event);
          } catch {
            // handler errors are non-fatal, silently continue
          }
        }
      }
      this.processing = false;
    });
  }

  async flush(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.queue.length === 0 && !this.processing) {
          resolve();
        } else {
          setImmediate(check);
        }
      };
      check();
    });
  }

  // ============================================================================

  spanStart(params: { spanId: SpanId; name: string; parentId?: SpanId; attrs?: Record<string, unknown> }): void {
    this.emit({
      type: 'span:start',
      eventId: randomUUID(),
      timestamp: Date.now(),
      spanId: params.spanId,
      parentId: params.parentId,
      name: params.name,
      attrs: params.attrs,
    });
  }

  spanLog(params: { spanId: SpanId; level: LogLevel; message: string; fields?: Record<string, unknown> }): void {
    this.emit({
      type: 'span:log',
      eventId: randomUUID(),
      timestamp: Date.now(),
      spanId: params.spanId,
      level: params.level,
      message: params.message,
      fields: params.fields,
    });
  }

  spanEnd(params: { spanId: SpanId; status: SpanStatus; error?: string; durationMs?: number }): void {
    this.emit({
      type: 'span:end',
      eventId: randomUUID(),
      timestamp: Date.now(),
      spanId: params.spanId,
      status: params.status,
      error: params.error,
      durationMs: params.durationMs,
    });
  }

  taskStateChange(params: {
    taskId: TaskId;
    runId: RunId;
    workspaceId: WorkspaceId;
    previousState: TaskState;
    newState: TaskState;
    attempt?: number;
    error?: string;
  }): void {
    this.emit({
      type: 'task:state',
      eventId: randomUUID(),
      timestamp: Date.now(),
      taskId: params.taskId,
      runId: params.runId,
      workspaceId: params.workspaceId,
      previousState: params.previousState,
      newState: params.newState,
      attempt: params.attempt,
      error: params.error,
    });
  }

  taskOutput(params: { taskId: TaskId; runId: RunId; stream: 'stdout' | 'stderr' | 'combined'; data: string }): void {
    this.emit({
      type: 'task:output',
      eventId: randomUUID(),
      timestamp: Date.now(),
      taskId: params.taskId,
      runId: params.runId,
      stream: params.stream,
      data: params.data,
    });
  }

  taskRetry(params: { taskId: TaskId; runId: RunId; attempt: number; maxAttempts: number; delayMs: number; reason: string }): void {
    this.emit({
      type: 'task:retry',
      eventId: randomUUID(),
      timestamp: Date.now(),
      taskId: params.taskId,
      runId: params.runId,
      attempt: params.attempt,
      maxAttempts: params.maxAttempts,
      delayMs: params.delayMs,
      reason: params.reason,
    });
  }

  schedulerStart(params: { planId: string; totalTasks: number; workspaces: string[] }): void {
    this.emit({
      type: 'scheduler:start',
      eventId: randomUUID(),
      timestamp: Date.now(),
      planId: params.planId,
      totalTasks: params.totalTasks,
      workspaces: params.workspaces,
    });
  }

  schedulerComplete(params: { planId: string; succeeded: number; failed: number; canceled: number; skipped: number; durationMs: number }): void {
    this.emit({
      type: 'scheduler:complete',
      eventId: randomUUID(),
      timestamp: Date.now(),
      planId: params.planId,
      succeeded: params.succeeded,
      failed: params.failed,
      canceled: params.canceled,
      skipped: params.skipped,
      durationMs: params.durationMs,
    });
  }
}

export const globalEventBus = new EventBus();
