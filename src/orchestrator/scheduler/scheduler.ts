import { randomUUID } from 'node:crypto';
import type {
  ExecutionPlan,
  TaskSpec,
  TaskRun,
  TaskState,
  TaskId,
  WorkspaceId,
  SchedulerConfig,
  ExitResult,
  RetryPolicy,
} from '../core/types.js';
import { isTerminalState, canTransition, DEFAULT_SCHEDULER_CONFIG } from '../core/types.js';
import type { Connector, ConnectorRegistry, RunHandle, ConnectorContext } from '../connectors/types.js';
import type { EventBus } from '../events/event-bus.js';
import type { Store } from '../store/memory-store.js';

export interface SchedulerResult {
  planId: string;
  succeeded: TaskId[];
  failed: TaskId[];
  canceled: TaskId[];
  skipped: TaskId[];
  durationMs: number;
}

interface RunningTask {
  taskId: TaskId;
  runId: string;
  handle: RunHandle;
  abortController: AbortController;
}

export class Scheduler {
  private config: SchedulerConfig;
  private events: EventBus;
  private store: Store;
  private connectors: ConnectorRegistry;

  private plan: ExecutionPlan | null = null;
  private taskRuns: Map<TaskId, TaskRun> = new Map();
  private indegree: Map<TaskId, number> = new Map();
  private readyQueue: TaskId[] = [];
  private runningTasks: Map<TaskId, RunningTask> = new Map();
  private workspaceConcurrency: Map<WorkspaceId, number> = new Map();
  private aborted = false;
  private startTime = 0;

  constructor(
    config: Partial<SchedulerConfig>,
    events: EventBus,
    store: Store,
    connectors: ConnectorRegistry
  ) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.events = events;
    this.store = store;
    this.connectors = connectors;
  }

  async execute(plan: ExecutionPlan): Promise<SchedulerResult> {
    this.plan = plan;
    this.startTime = Date.now();
    this.aborted = false;

    this.indegree = new Map(plan.indegree);
    this.readyQueue = [];
    this.runningTasks.clear();
    this.workspaceConcurrency.clear();
    this.taskRuns.clear();

    for (const [taskId, spec] of plan.tasks) {
      const run: TaskRun = {
        runId: randomUUID(),
        specId: taskId,
        state: 'pending',
        attempt: 1,
      };
      this.taskRuns.set(taskId, run);
      this.store.saveTaskRun(run);
    }

    for (const taskId of plan.roots) {
      this.enqueue(taskId);
    }

    this.events.schedulerStart({
      planId: plan.id,
      totalTasks: plan.tasks.size,
      workspaces: Array.from(plan.workspaces.keys()),
    });

    await this.runLoop();
    const result = this.collectResults();

    this.events.schedulerComplete({
      planId: plan.id,
      succeeded: result.succeeded.length,
      failed: result.failed.length,
      canceled: result.canceled.length,
      skipped: result.skipped.length,
      durationMs: result.durationMs,
    });

    return result;
  }

  abort(): void {
    this.aborted = true;
    for (const running of this.runningTasks.values()) {
      running.abortController.abort();
      running.handle.cancel();
    }
  }

  private async runLoop(): Promise<void> {
    while (!this.isDone()) {
      while (this.canStartMore()) {
        const taskId = this.dequeue();
        if (!taskId) break;

        await this.startTask(taskId);
      }

      if (this.runningTasks.size > 0) {
        await this.waitForAnyCompletion();
      } else if (this.readyQueue.length === 0) {
        break;
      }
    }
  }

  private isDone(): boolean {
    if (this.aborted) return true;

    for (const run of this.taskRuns.values()) {
      if (!isTerminalState(run.state)) {
        return false;
      }
    }
    return true;
  }

  private canStartMore(): boolean {
    if (this.aborted) return false;
    if (this.readyQueue.length === 0) return false;
    // Check global concurrency limit (Infinity or undefined = unlimited)
    const limit = this.config.globalConcurrency ?? Infinity;
    if (limit !== Infinity && this.runningTasks.size >= limit) return false;
    return true;
  }

  private enqueue(taskId: TaskId): void {
    const run = this.taskRuns.get(taskId)!;
    this.transition(taskId, 'queued');
    run.queuedAt = Date.now();

    const spec = this.plan!.tasks.get(taskId)!;
    const priority = this.getPriority(spec);

    let inserted = false;
    for (let i = 0; i < this.readyQueue.length; i++) {
      const otherSpec = this.plan!.tasks.get(this.readyQueue[i])!;
      if (priority > this.getPriority(otherSpec)) {
        this.readyQueue.splice(i, 0, taskId);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.readyQueue.push(taskId);
    }

    this.events.emit({
      type: 'scheduler:queue',
      eventId: randomUUID(),
      timestamp: Date.now(),
      taskId,
      queueSize: this.readyQueue.length,
      runningCount: this.runningTasks.size,
    });
  }

  private dequeue(): TaskId | undefined {
    for (let i = 0; i < this.readyQueue.length; i++) {
      const taskId = this.readyQueue[i];
      const spec = this.plan!.tasks.get(taskId)!;

      if (this.canRunInWorkspace(spec.workspaceId)) {
        this.readyQueue.splice(i, 1);
        return taskId;
      }
    }
    return undefined;
  }

  private canRunInWorkspace(workspaceId: WorkspaceId): boolean {
    const current = this.workspaceConcurrency.get(workspaceId) ?? 0;
    // Check workspace concurrency limit (Infinity or undefined = unlimited)
    const limit =
      this.config.workspaceConcurrency?.[workspaceId] ??
      this.plan!.workspaces.get(workspaceId)?.concurrency ??
      Infinity;

    return limit === Infinity || current < limit;
  }

  private getPriority(spec: TaskSpec): number {
    // Could be extended with priority field on spec
    return 0;
  }

  private async startTask(taskId: TaskId): Promise<void> {
    const spec = this.plan!.tasks.get(taskId)!;
    const run = this.taskRuns.get(taskId)!;
    const workspace = this.plan!.workspaces.get(spec.workspaceId)!;

    const connector = this.connectors.findFor(spec);
    if (!connector) {
      this.handleTaskFailure(taskId, new Error(`No connector for action type: ${spec.action.type}`));
      return;
    }

    this.transition(taskId, 'running');
    run.startedAt = Date.now();

    const currentWs = this.workspaceConcurrency.get(spec.workspaceId) ?? 0;
    this.workspaceConcurrency.set(spec.workspaceId, currentWs + 1);

    const abortController = new AbortController();

    const ctx: ConnectorContext = {
      workspace,
      events: this.events,
      signal: abortController.signal,
      parentSpanId: run.spanId,
    };

    try {
      const spanId = randomUUID();
      run.spanId = spanId;
      this.events.spanStart({
        spanId,
        name: `task:${spec.name}`,
        parentId: undefined,
        attrs: {
          taskId,
          workspace: workspace.name,
          action: spec.action.type,
          attempt: run.attempt,
        },
      });

      const handle = await connector.start(ctx, spec);

      this.runningTasks.set(taskId, {
        taskId,
        runId: run.runId,
        handle,
        abortController,
      });

      this.store.saveTaskRun(run);
    } catch (err) {
      this.handleTaskFailure(taskId, err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async waitForAnyCompletion(): Promise<void> {
    if (this.runningTasks.size === 0) return;

    const completions = Array.from(this.runningTasks.entries()).map(
      async ([taskId, running]) => {
        try {
          const result = await running.handle.wait();
          return { taskId, result, error: null };
        } catch (err) {
          return { taskId, result: null, error: err };
        }
      }
    );

    const { taskId, result, error } = await Promise.race(completions);

    if (error) {
      this.handleTaskFailure(taskId, error instanceof Error ? error : new Error(String(error)));
    } else if (result) {
      this.handleTaskCompletion(taskId, result);
    }
  }

  private handleTaskCompletion(taskId: TaskId, result: ExitResult): void {
    const spec = this.plan!.tasks.get(taskId)!;
    const run = this.taskRuns.get(taskId)!;

    this.runningTasks.delete(taskId);
    const currentWs = this.workspaceConcurrency.get(spec.workspaceId) ?? 0;
    this.workspaceConcurrency.set(spec.workspaceId, Math.max(0, currentWs - 1));

    run.finishedAt = Date.now();
    run.result = result;

    if (run.spanId) {
      this.events.spanEnd({
        spanId: run.spanId,
        status: result.code === 0 ? 'ok' : 'error',
        error: result.code !== 0 ? `Exit code: ${result.code}` : undefined,
        durationMs: result.durationMs,
      });
    }

    if (result.code === 0) {
      this.transition(taskId, 'succeeded');
      this.onTaskSucceeded(taskId);
    } else {
      const retryPolicy = spec.retry ?? this.config.defaultRetry;
      if (run.attempt < retryPolicy.maxAttempts) {
        this.scheduleRetry(taskId, retryPolicy, result.error?.message ?? `Exit code: ${result.code}`);
      } else {
        run.error = result.error?.message ?? `Exit code: ${result.code}`;
        this.transition(taskId, 'failed');
        this.onTaskFailed(taskId);
      }
    }

    this.store.saveTaskRun(run);
  }

  private handleTaskFailure(taskId: TaskId, error: Error): void {
    const spec = this.plan!.tasks.get(taskId)!;
    const run = this.taskRuns.get(taskId)!;

    this.runningTasks.delete(taskId);
    const currentWs = this.workspaceConcurrency.get(spec.workspaceId) ?? 0;
    this.workspaceConcurrency.set(spec.workspaceId, Math.max(0, currentWs - 1));

    run.finishedAt = Date.now();
    run.error = error.message;

    if (run.spanId) {
      this.events.spanEnd({ spanId: run.spanId, status: 'error', error: error.message });
    }

    const retryPolicy = spec.retry ?? this.config.defaultRetry;
    if (run.attempt < retryPolicy.maxAttempts && this.shouldRetry(error, retryPolicy)) {
      this.scheduleRetry(taskId, retryPolicy, error.message);
    } else {
      this.transition(taskId, 'failed');
      this.onTaskFailed(taskId);
    }

    this.store.saveTaskRun(run);
  }

  private shouldRetry(error: Error, policy: RetryPolicy): boolean {
    if (!policy.retryableErrors || policy.retryableErrors.length === 0) {
      return true; // Retry all errors by default
    }
    return policy.retryableErrors.some((pattern) =>
      error.message.includes(pattern)
    );
  }

  private scheduleRetry(taskId: TaskId, policy: RetryPolicy, reason: string): void {
    const run = this.taskRuns.get(taskId)!;

    const baseDelay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, run.attempt - 1);
    const jitter = Math.random() * 0.3 * baseDelay; // 30% jitter
    const delay = Math.min(baseDelay + jitter, policy.maxDelayMs);

    this.events.taskRetry({
      taskId,
      runId: run.runId,
      attempt: run.attempt,
      maxAttempts: policy.maxAttempts,
      delayMs: delay,
      reason,
    });

    setTimeout(() => {
      if (this.aborted) return;

      run.attempt++;
      run.state = 'pending';
      run.startedAt = undefined;
      run.finishedAt = undefined;
      run.result = undefined;
      run.error = undefined;
      run.spanId = undefined;

      this.enqueue(taskId);
      this.store.saveTaskRun(run);
    }, delay);
  }

  private onTaskSucceeded(taskId: TaskId): void {
    const dependents = this.plan!.dependents.get(taskId) ?? new Set();
    for (const depId of dependents) {
      const newDegree = this.indegree.get(depId)! - 1;
      this.indegree.set(depId, newDegree);

      if (newDegree === 0) {
        const depRun = this.taskRuns.get(depId)!;
        if (depRun.state === 'pending') {
          this.enqueue(depId);
        }
      }
    }
  }

  private onTaskFailed(taskId: TaskId): void {
    const spec = this.plan!.tasks.get(taskId)!;

    const dependents = this.plan!.dependents.get(taskId) ?? new Set();
    const newState = spec.allowFailure ? 'skipped' : (this.config.cancelOnFailure ? 'canceled' : 'skipped');

    this.propagateFailure(dependents, newState, `Dependency ${taskId} failed`);
  }

  private propagateFailure(taskIds: Set<TaskId>, state: 'canceled' | 'skipped', reason: string): void {
    for (const taskId of taskIds) {
      const run = this.taskRuns.get(taskId)!;
      if (isTerminalState(run.state)) continue;

      const running = this.runningTasks.get(taskId);
      if (running) {
        running.abortController.abort();
        running.handle.cancel();
        this.runningTasks.delete(taskId);
      }

      const queueIdx = this.readyQueue.indexOf(taskId);
      if (queueIdx >= 0) {
        this.readyQueue.splice(queueIdx, 1);
      }

      run.error = reason;
      this.transition(taskId, state);
      this.store.saveTaskRun(run);

      const dependents = this.plan!.dependents.get(taskId) ?? new Set();
      this.propagateFailure(dependents, state, reason);
    }
  }

  private transition(taskId: TaskId, newState: TaskState): void {
    const run = this.taskRuns.get(taskId)!;
    const previousState = run.state;

    if (!canTransition(previousState, newState)) {
      return;
    }

    run.state = newState;

    const spec = this.plan!.tasks.get(taskId)!;
    this.events.taskStateChange({
      taskId,
      runId: run.runId,
      workspaceId: spec.workspaceId,
      previousState,
      newState,
      attempt: run.attempt,
      error: run.error,
    });
  }

  private collectResults(): SchedulerResult {
    const succeeded: TaskId[] = [];
    const failed: TaskId[] = [];
    const canceled: TaskId[] = [];
    const skipped: TaskId[] = [];

    for (const [taskId, run] of this.taskRuns) {
      switch (run.state) {
        case 'succeeded':
          succeeded.push(taskId);
          break;
        case 'failed':
          failed.push(taskId);
          break;
        case 'canceled':
          canceled.push(taskId);
          break;
        case 'skipped':
          skipped.push(taskId);
          break;
      }
    }

    return {
      planId: this.plan!.id,
      succeeded,
      failed,
      canceled,
      skipped,
      durationMs: Date.now() - this.startTime,
    };
  }
}
