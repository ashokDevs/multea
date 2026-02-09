import { EventEmitter } from 'node:events';
import type { TaskItem, TaskPriority, TaskStatus } from '../types.js';

let nextId = 1;

export interface TaskQueueEvents {
  taskUnblocked: [{ task: TaskItem }];
  taskStatusChange: [{ task: TaskItem; previousStatus: TaskStatus }];
  dependenciesResolved: [{ taskId: string; unblockedTasks: TaskItem[] }];
}

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export interface EnqueueOptions {
  dependsOn?: string[];
  priority?: TaskPriority;
  tags?: string[];
}

export class TaskQueue extends EventEmitter<TaskQueueEvents> {
  private _tasks: Map<string, TaskItem> = new Map();

  enqueue(projectName: string, prompt: string, options: EnqueueOptions = {}): TaskItem {
    const id = String(nextId++);
    const dependsOn = options.dependsOn ?? [];

    const hasUnresolvedDeps = dependsOn.some((depId) => {
      const depTask = this._tasks.get(depId);
      return !depTask || depTask.status !== 'done';
    });

    const task: TaskItem = {
      id,
      projectName,
      prompt,
      status: hasUnresolvedDeps ? 'blocked' : 'pending',
      priority: options.priority ?? 'normal',
      dependsOn,
      blockedBy: [],
      createdAt: Date.now(),
      tags: options.tags,
    };

    for (const depId of dependsOn) {
      const depTask = this._tasks.get(depId);
      if (depTask && depTask.status !== 'done' && depTask.status !== 'error') {
        depTask.blockedBy.push(id);
      }
    }

    this._tasks.set(id, task);
    return task;
  }

  dequeue(projectName: string): TaskItem | undefined {
    const pendingTasks = Array.from(this._tasks.values())
      .filter((t) => t.projectName === projectName && t.status === 'pending')
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

    const task = pendingTasks[0];
    if (task) {
      this.setStatus(task.id, 'running');
      task.startedAt = Date.now();
    }
    return task;
  }

  complete(id: string, success: boolean, result?: string): TaskItem[] {
    const task = this._tasks.get(id);
    if (!task) return [];

    const previousStatus = task.status;
    task.status = success ? 'done' : 'error';
    task.completedAt = Date.now();
    if (result) task.result = result;
    if (!success && !task.error) task.error = 'Task failed';

    this.emit('taskStatusChange', { task, previousStatus });

    const unblockedTasks: TaskItem[] = [];
    if (success) {
      for (const blockedId of task.blockedBy) {
        const blockedTask = this._tasks.get(blockedId);
        if (blockedTask && blockedTask.status === 'blocked') {
          const allDepsResolved = blockedTask.dependsOn.every((depId) => {
            const dep = this._tasks.get(depId);
            return dep && dep.status === 'done';
          });

          if (allDepsResolved) {
            blockedTask.status = 'pending';
            unblockedTasks.push(blockedTask);
            this.emit('taskUnblocked', { task: blockedTask });
          }
        }
      }

      if (unblockedTasks.length > 0) {
        this.emit('dependenciesResolved', { taskId: id, unblockedTasks });
      }
    } else {
      this.cancelDependentTasks(id, `Dependency task #${id} failed`);
    }

    return unblockedTasks;
  }

  cancel(id: string, reason?: string): void {
    const task = this._tasks.get(id);
    if (!task || task.status === 'done' || task.status === 'cancelled') return;

    const previousStatus = task.status;
    task.status = 'cancelled';
    task.error = reason ?? 'Cancelled';
    task.completedAt = Date.now();

    this.emit('taskStatusChange', { task, previousStatus });
    this.cancelDependentTasks(id, `Dependency task #${id} was cancelled`);
  }

  private cancelDependentTasks(taskId: string, reason: string): void {
    const task = this._tasks.get(taskId);
    if (!task) return;

    for (const blockedId of task.blockedBy) {
      this.cancel(blockedId, reason);
    }
  }

  private setStatus(id: string, status: TaskStatus): void {
    const task = this._tasks.get(id);
    if (task && task.status !== status) {
      const previousStatus = task.status;
      task.status = status;
      this.emit('taskStatusChange', { task, previousStatus });
    }
  }

  get(id: string): TaskItem | undefined {
    return this._tasks.get(id);
  }

  getByProject(projectName: string): TaskItem[] {
    return Array.from(this._tasks.values()).filter((t) => t.projectName === projectName);
  }

  getPending(): TaskItem[] {
    return Array.from(this._tasks.values()).filter((t) => t.status === 'pending');
  }

  getBlocked(): TaskItem[] {
    return Array.from(this._tasks.values()).filter((t) => t.status === 'blocked');
  }

  getRunning(): TaskItem[] {
    return Array.from(this._tasks.values()).filter((t) => t.status === 'running');
  }

  getCompleted(): TaskItem[] {
    return Array.from(this._tasks.values()).filter((t) => t.status === 'done' || t.status === 'error');
  }

  getAll(): readonly TaskItem[] {
    return Array.from(this._tasks.values());
  }

  getTask(id: string): TaskItem | undefined {
    return this._tasks.get(id);
  }

  getDependencyGraph(): { nodes: TaskItem[]; edges: Array<{ from: string; to: string }> } {
    const nodes = Array.from(this._tasks.values());
    const edges: Array<{ from: string; to: string }> = [];

    for (const task of nodes) {
      for (const depId of task.dependsOn) {
        edges.push({ from: depId, to: task.id });
      }
    }

    return { nodes, edges };
  }

  getStats(): {
    total: number;
    pending: number;
    blocked: number;
    running: number;
    done: number;
    error: number;
    cancelled: number;
    byProject: Record<string, number>;
    byPriority: Record<TaskPriority, number>;
  } {
    const tasks = Array.from(this._tasks.values());
    const byProject: Record<string, number> = {};
    const byPriority: Record<TaskPriority, number> = { critical: 0, high: 0, normal: 0, low: 0 };

    for (const task of tasks) {
      byProject[task.projectName] = (byProject[task.projectName] ?? 0) + 1;
      byPriority[task.priority]++;
    }

    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      blocked: tasks.filter((t) => t.status === 'blocked').length,
      running: tasks.filter((t) => t.status === 'running').length,
      done: tasks.filter((t) => t.status === 'done').length,
      error: tasks.filter((t) => t.status === 'error').length,
      cancelled: tasks.filter((t) => t.status === 'cancelled').length,
      byProject,
      byPriority,
    };
  }

  pruneCompleted(maxAgeMs: number = 36_00_000): number {
    const now = Date.now();
    let pruned = 0;

    for (const [id, task] of this._tasks) {
      if (
        (task.status === 'done' || task.status === 'error' || task.status === 'cancelled') &&
        task.completedAt &&
        now - task.completedAt > maxAgeMs
      ) {
        this._tasks.delete(id);
        pruned++;
      }
    }

    return pruned;
  }

  clear(): void {
    this._tasks.clear();
  }
}
