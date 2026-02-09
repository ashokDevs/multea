export * from './core/types.js';
export * from './events/types.js';
export * from './events/event-bus.js';
export * from './connectors/types.js';
export * from './connectors/local-process.js';
export * from './connectors/claude-agent.js';
export * from './store/memory-store.js';
export * from './scheduler/dag-planner.js';
export * from './scheduler/scheduler.js';
export * from './questions/types.js';
export * from './questions/question-queue.js';

import { randomUUID } from 'node:crypto';
import type { TaskSpec, Workspace, SchedulerConfig, TaskId } from './core/types.js';
import { EventBus, globalEventBus } from './events/event-bus.js';
import type { OrchestratorEvent } from './events/types.js';
import { ConnectorRegistry } from './connectors/types.js';
import { LocalProcessConnector } from './connectors/local-process.js';
import { ClaudeAgentConnector } from './connectors/claude-agent.js';
import { MemoryStore } from './store/memory-store.js';
import { buildExecutionPlan, type PlannerInput } from './scheduler/dag-planner.js';
import { Scheduler, type SchedulerResult } from './scheduler/scheduler.js';

export interface OrchestratorConfig {
  scheduler?: Partial<SchedulerConfig>;
  eventBus?: EventBus;
}

export class Orchestrator {
  private events: EventBus;
  private store: MemoryStore;
  private connectors: ConnectorRegistry;
  private scheduler: Scheduler | null = null;
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig = {}) {
    this.config = config;
    this.events = config.eventBus ?? globalEventBus;
    this.store = new MemoryStore();
    this.connectors = new ConnectorRegistry();

    this.connectors.register(new LocalProcessConnector());
    this.connectors.register(new ClaudeAgentConnector());
  }

  on(handler: (event: OrchestratorEvent) => void): () => void {
    return this.events.subscribe(handler);
  }

  registerWorkspace(workspace: Workspace): void {
    this.store.saveWorkspace(workspace);
  }

  registerWorkspaces(workspaces: Workspace[]): void {
    for (const ws of workspaces) {
      this.store.saveWorkspace(ws);
    }
  }

  getWorkspaces(): Workspace[] {
    return this.store.getAllWorkspaces();
  }

  registerConnector(connector: import('./connectors/types.js').Connector): void {
    this.connectors.register(connector);
  }

  async execute(tasks: TaskSpec[]): Promise<SchedulerResult> {
    const workspaces = this.store.getAllWorkspaces();

    const input: PlannerInput = { workspaces, tasks };
    const plan = buildExecutionPlan(input);

    this.store.saveExecutionPlan(plan);
    for (const spec of tasks) {
      this.store.saveTaskSpec(spec);
    }

    this.scheduler = new Scheduler(
      this.config.scheduler ?? {},
      this.events,
      this.store,
      this.connectors
    );

    const result = await this.scheduler.execute(plan);
    this.scheduler = null;

    return result;
  }

  abort(): void {
    this.scheduler?.abort();
  }

  getStore(): MemoryStore {
    return this.store;
  }

  async dispose(): Promise<void> {
    this.abort();
    await this.connectors.disposeAll();
    await this.events.flush();
  }
}

// ============================================================================

export function workspace(params: { id: string; name: string; rootPath: string; concurrency?: number }): Workspace {
  return { id: params.id, name: params.name, rootPath: params.rootPath, concurrency: params.concurrency };
}

export function shellTask(
  params: { id: TaskId; workspaceId: string; name: string; command: string } & Partial<Omit<TaskSpec, 'id' | 'workspaceId' | 'name' | 'action'>>
): TaskSpec {
  const { id, workspaceId, name, command, ...rest } = params;
  return {
    id,
    workspaceId,
    name,
    deps: [],
    action: { type: 'shell', command },
    ...rest,
  };
}

export function agentTask(
  params: { id: TaskId; workspaceId: string; name: string; prompt: string } & Partial<Omit<TaskSpec, 'id' | 'workspaceId' | 'name' | 'action'>>
): TaskSpec {
  const { id, workspaceId, name, prompt, ...rest } = params;
  return {
    id,
    workspaceId,
    name,
    deps: [],
    action: { type: 'claude-agent', prompt },
    ...rest,
  };
}

// ============================================================================

export async function runPipeline(
  workspaces: Workspace[],
  tasks: TaskSpec[],
  options: OrchestratorConfig = {}
): Promise<SchedulerResult> {
  const orchestrator = new Orchestrator(options);
  orchestrator.registerWorkspaces(workspaces);

  try {
    return await orchestrator.execute(tasks);
  } finally {
    await orchestrator.dispose();
  }
}
