import { randomUUID } from 'node:crypto';
import type { TaskSpec, Workspace, ExecutionPlan, TaskId, WorkspaceId } from '../core/types.js';

export interface PlannerInput {
  workspaces: Workspace[];
  tasks: TaskSpec[];
}

export class DAGPlannerError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'DAGPlannerError';
  }
}

export function buildExecutionPlan(input: PlannerInput): ExecutionPlan {
  const { workspaces, tasks } = input;

  const workspaceMap = new Map<WorkspaceId, Workspace>();
  for (const ws of workspaces) {
    workspaceMap.set(ws.id, ws);
  }

  const taskMap = new Map<TaskId, TaskSpec>();
  for (const task of tasks) {
    if (taskMap.has(task.id)) {
      throw new DAGPlannerError(`Duplicate task ID: ${task.id}`);
    }
    if (!workspaceMap.has(task.workspaceId)) {
      throw new DAGPlannerError(`Task ${task.id} references unknown workspace: ${task.workspaceId}`);
    }
    taskMap.set(task.id, task);
  }

  for (const task of tasks) {
    for (const depId of task.deps) {
      if (!taskMap.has(depId)) {
        throw new DAGPlannerError(`Task ${task.id} depends on unknown task: ${depId}`);
      }
    }
  }

  const dependents = new Map<TaskId, Set<TaskId>>(); // task -> tasks that depend on it
  const dependencies = new Map<TaskId, Set<TaskId>>(); // task -> tasks it depends on
  const indegree = new Map<TaskId, number>();

  for (const task of tasks) {
    dependents.set(task.id, new Set());
    dependencies.set(task.id, new Set(task.deps));
    indegree.set(task.id, task.deps.length);
  }

  for (const task of tasks) {
    for (const depId of task.deps) {
      dependents.get(depId)!.add(task.id);
    }
  }

  detectCycles(taskMap, dependencies);

  const roots = new Set<TaskId>();
  for (const [taskId, degree] of indegree) {
    if (degree === 0) {
      roots.add(taskId);
    }
  }

  if (roots.size === 0 && tasks.length > 0) {
    throw new DAGPlannerError('No root tasks found - all tasks have dependencies (possible cycle)');
  }

  return {
    id: randomUUID(),
    workspaces: workspaceMap,
    tasks: taskMap,
    dependents,
    dependencies,
    indegree,
    roots,
    createdAt: Date.now(),
  };
}

function detectCycles(
  tasks: Map<TaskId, TaskSpec>,
  dependencies: Map<TaskId, Set<TaskId>>
): void {
  const WHITE = 0; // Not visited
  const GRAY = 1;  // Visiting (in current path)
  const BLACK = 2; // Visited (done)

  const color = new Map<TaskId, number>();
  for (const taskId of tasks.keys()) {
    color.set(taskId, WHITE);
  }

  const path: TaskId[] = [];

  function dfs(taskId: TaskId): void {
    color.set(taskId, GRAY);
    path.push(taskId);

    const deps = dependencies.get(taskId) ?? new Set();
    for (const depId of deps) {
      if (color.get(depId) === GRAY) {
        const cycleStart = path.indexOf(depId);
        const cycle = path.slice(cycleStart).concat(depId);
        throw new DAGPlannerError(
          `Circular dependency detected: ${cycle.join(' -> ')}`,
          { cycle }
        );
      }
      if (color.get(depId) === WHITE) {
        dfs(depId);
      }
    }

    path.pop();
    color.set(taskId, BLACK);
  }

  for (const taskId of tasks.keys()) {
    if (color.get(taskId) === WHITE) {
      dfs(taskId);
    }
  }
}

export function getTopologicalOrder(plan: ExecutionPlan): TaskId[] {
  const order: TaskId[] = [];
  const indegree = new Map(plan.indegree);
  const queue: TaskId[] = [...plan.roots];

  while (queue.length > 0) {
    const taskId = queue.shift()!;
    order.push(taskId);

    const deps = plan.dependents.get(taskId) ?? new Set();
    for (const depId of deps) {
      const newDegree = indegree.get(depId)! - 1;
      indegree.set(depId, newDegree);
      if (newDegree === 0) {
        queue.push(depId);
      }
    }
  }

  return order;
}

export function validatePlan(plan: ExecutionPlan): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const order = getTopologicalOrder(plan);

  if (order.length !== plan.tasks.size) {
    const reachable = new Set(order);
    const unreachable = [...plan.tasks.keys()].filter((id) => !reachable.has(id));
    errors.push(`Unreachable tasks: ${unreachable.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
