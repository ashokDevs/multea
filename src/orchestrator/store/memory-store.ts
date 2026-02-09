// MVP implementation - upgrade path to SQLite for durability
import type { TaskRun, TaskSpec, Workspace, ExecutionPlan, RunId, TaskId, WorkspaceId } from '../core/types.js';

export interface Store {
  saveWorkspace(workspace: Workspace): void;
  getWorkspace(id: WorkspaceId): Workspace | undefined;
  getAllWorkspaces(): Workspace[];

  saveTaskSpec(spec: TaskSpec): void;
  getTaskSpec(id: TaskId): TaskSpec | undefined;
  getAllTaskSpecs(): TaskSpec[];

  saveTaskRun(run: TaskRun): void;
  getTaskRun(runId: RunId): TaskRun | undefined;
  getTaskRunsBySpec(specId: TaskId): TaskRun[];
  getLatestTaskRun(specId: TaskId): TaskRun | undefined;
  getAllTaskRuns(): TaskRun[];

  saveExecutionPlan(plan: ExecutionPlan): void;
  getExecutionPlan(id: string): ExecutionPlan | undefined;

  clear(): void;
}

export class MemoryStore implements Store {
  private workspaces: Map<WorkspaceId, Workspace> = new Map();
  private taskSpecs: Map<TaskId, TaskSpec> = new Map();
  private taskRuns: Map<RunId, TaskRun> = new Map();
  private taskRunsBySpec: Map<TaskId, RunId[]> = new Map();
  private executionPlans: Map<string, ExecutionPlan> = new Map();

  saveWorkspace(workspace: Workspace): void {
    this.workspaces.set(workspace.id, workspace);
  }

  getWorkspace(id: WorkspaceId): Workspace | undefined {
    return this.workspaces.get(id);
  }

  getAllWorkspaces(): Workspace[] {
    return Array.from(this.workspaces.values());
  }

  saveTaskSpec(spec: TaskSpec): void {
    this.taskSpecs.set(spec.id, spec);
  }

  getTaskSpec(id: TaskId): TaskSpec | undefined {
    return this.taskSpecs.get(id);
  }

  getAllTaskSpecs(): TaskSpec[] {
    return Array.from(this.taskSpecs.values());
  }

  saveTaskRun(run: TaskRun): void {
    this.taskRuns.set(run.runId, run);

    const specRuns = this.taskRunsBySpec.get(run.specId) ?? [];
    if (!specRuns.includes(run.runId)) {
      specRuns.push(run.runId);
      this.taskRunsBySpec.set(run.specId, specRuns);
    }
  }

  getTaskRun(runId: RunId): TaskRun | undefined {
    return this.taskRuns.get(runId);
  }

  getTaskRunsBySpec(specId: TaskId): TaskRun[] {
    const runIds = this.taskRunsBySpec.get(specId) ?? [];
    return runIds
      .map((id) => this.taskRuns.get(id))
      .filter((run): run is TaskRun => run !== undefined);
  }

  getLatestTaskRun(specId: TaskId): TaskRun | undefined {
    const runs = this.getTaskRunsBySpec(specId);
    if (runs.length === 0) return undefined;

    return runs.reduce((latest, run) =>
      run.attempt > latest.attempt ? run : latest
    );
  }

  getAllTaskRuns(): TaskRun[] {
    return Array.from(this.taskRuns.values());
  }

  saveExecutionPlan(plan: ExecutionPlan): void {
    this.executionPlans.set(plan.id, plan);
  }

  getExecutionPlan(id: string): ExecutionPlan | undefined {
    return this.executionPlans.get(id);
  }

  clear(): void {
    this.workspaces.clear();
    this.taskSpecs.clear();
    this.taskRuns.clear();
    this.taskRunsBySpec.clear();
    this.executionPlans.clear();
  }

  getStats(): {
    workspaces: number;
    taskSpecs: number;
    taskRuns: number;
    executionPlans: number;
  } {
    return {
      workspaces: this.workspaces.size,
      taskSpecs: this.taskSpecs.size,
      taskRuns: this.taskRuns.size,
      executionPlans: this.executionPlans.size,
    };
  }
}
