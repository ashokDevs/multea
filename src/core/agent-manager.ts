import { EventEmitter } from 'node:events';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentRunner } from './agent-runner.js';
import { TaskQueue, type EnqueueOptions } from './task-queue.js';
import type { ProjectConfig, AgentState, AgentOutput, TaskItem } from '../types.js';

export interface AgentManagerEvents {
  agentStateChange: [{ name: string; state: AgentState }];
  agentOutput: [{ name: string; output: AgentOutput }];
  agentQuestion: [{ name: string; question: string }];
  taskComplete: [{ name: string; taskId: string; success: boolean; output: string; prompt: string }];
  taskUnblocked: [{ task: TaskItem }];
  taskCreated: [{ task: TaskItem }];
  projectAdded: [{ project: ProjectConfig }];
  projectRemoved: [{ name: string }];
}

export class AgentManager extends EventEmitter<AgentManagerEvents> {
  private runners: Map<string, AgentRunner> = new Map();
  private _projects: Map<string, ProjectConfig> = new Map();
  readonly taskQueue: TaskQueue = new TaskQueue();
  private _runningTasks: Map<string, string> = new Map();
  private logDir: string;
  private authMethod: 'api' | 'auth';

  constructor(projects: ProjectConfig[], authMethod: 'api' | 'auth' = 'auth', logDir = './logs') {
    super();
    this.authMethod = authMethod;
    this.logDir = logDir;
    mkdirSync(logDir, { recursive: true });

    this.taskQueue.on('taskUnblocked', ({ task }) => {
      this.emit('taskUnblocked', { task });
      this.tryDispatchNext(task.projectName);
    });

    this.taskQueue.on('dependenciesResolved', ({ unblockedTasks }) => {
      const projectNames = new Set(unblockedTasks.map((t) => t.projectName));
      for (const projectName of projectNames) {
        this.tryDispatchNext(projectName);
      }
    });

    for (const project of projects) {
      this._projects.set(project.name, project);
      const runner = new AgentRunner(project.name, project.path, this.authMethod);
      this.wireRunnerEvents(project.name, runner);
      this.runners.set(project.name, runner);
    }
  }

  private wireRunnerEvents(projectName: string, runner: AgentRunner): void {
    runner.on('stateChange', (state) => {
      this.emit('agentStateChange', { name: projectName, state });
    });

    runner.on('output', (output) => {
      this.emit('agentOutput', { name: projectName, output });
      this.logOutput(projectName, output);

      if (output.type === 'text' && this.looksLikeQuestion(output.content)) {
        this.emit('agentQuestion', { name: projectName, question: output.content });
      }
    });

    runner.on('done', ({ success }) => {
      const taskId = this._runningTasks.get(projectName);
      if (taskId) {
        const fullOutput = runner.outputBuffer
          .filter((o) => o.type === 'text')
          .map((o) => o.content)
          .join('\n');

        const summary = fullOutput.slice(0, 500);
        this.taskQueue.complete(taskId, success, summary || undefined);
        this._runningTasks.delete(projectName);

        this.emit('taskComplete', {
          name: projectName,
          taskId,
          success,
          output: fullOutput,
          prompt: this.taskQueue.getTask(taskId)?.prompt || '',
        });
      }
      this.tryDispatchNext(projectName);
    });
  }

  private logOutput(name: string, output: AgentOutput) {
    const logFile = join(this.logDir, `${name}.log`);
    const line = `[${new Date(output.timestamp).toISOString()}] [${output.type}] ${output.content}\n`;
    try {
      appendFileSync(logFile, line);
    } catch {
      // ignore log errors
    }
  }

  private looksLikeQuestion(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.endsWith('?')) return true;
    const questionPatterns = [
      /^(would you|should i|do you|can you|could you|shall i|may i)/i,
      /^(which|what|where|how|when|why|who)\b/i,
      /please (confirm|choose|select|specify|clarify|let me know)/i,
      /\b(prefer|want me to|like me to)\b/i,
    ];
    return questionPatterns.some((p) => p.test(trimmed));
  }

  private tryDispatchNext(projectName: string): void {
    const runner = this.runners.get(projectName);
    if (!runner) return;
    if (runner.state === 'running' || runner.state === 'paused') return;

    const task = this.taskQueue.dequeue(projectName);
    if (task) {
      this._runningTasks.set(projectName, task.id);
      // Fire-and-forget - completion handled via events
      runner.sendPrompt(task.prompt).catch((error) => {
        const errorMsg = `Error: ${error}`;
        this.taskQueue.complete(task.id, false, errorMsg);
        this._runningTasks.delete(projectName);
        this.emit('taskComplete', {
          name: projectName,
          taskId: task.id,
          success: false,
          output: errorMsg,
          prompt: task.prompt,
        });
      });
    }
  }

  tryDispatchAll(): void {
    for (const projectName of this.runners.keys()) {
      this.tryDispatchNext(projectName);
    }
  }

  getAgent(name: string): AgentRunner | undefined {
    return this.runners.get(name);
  }

  getAgentNames(): string[] {
    return [...this.runners.keys()];
  }

  getStates(): Map<string, AgentState> {
    const states = new Map<string, AgentState>();
    for (const [name, runner] of this.runners) {
      states.set(name, runner.state);
    }
    return states;
  }

  startAll() {
    for (const runner of this.runners.values()) {
      runner.start();
    }
  }

  dispatchTask(projectName: string, prompt: string, options: EnqueueOptions = {}): TaskItem | undefined {
    const runner = this.runners.get(projectName);
    if (!runner) return undefined;

    const task = this.taskQueue.enqueue(projectName, prompt, options);
    this.emit('taskCreated', { task });

    if (task.status === 'pending') {
      this.tryDispatchNext(projectName);
    }

    return task;
  }

  cancelTask(taskId: string, reason?: string): void {
    this.taskQueue.cancel(taskId, reason);
  }

  getTask(taskId: string): TaskItem | undefined {
    return this.taskQueue.get(taskId);
  }

  pauseAgent(name: string) {
    this.runners.get(name)?.pause();
  }

  resumeAgent(name: string) {
    this.runners.get(name)?.resume();
  }

  stopAgent(name: string) {
    this.runners.get(name)?.abort();
  }

  stopAll() {
    for (const runner of this.runners.values()) {
      runner.stop();
    }
  }

  getProjects(): ProjectConfig[] {
    return Array.from(this._projects.values());
  }

  addProject(project: ProjectConfig): boolean {
    if (this.runners.has(project.name)) {
      return false;
    }

    this._projects.set(project.name, project);

    const runner = new AgentRunner(project.name, project.path, this.authMethod);
    this.wireRunnerEvents(project.name, runner);
    this.runners.set(project.name, runner);
    runner.start();

    this.emit('projectAdded', { project });
    return true;
  }

  removeProject(name: string): boolean {
    const runner = this.runners.get(name);
    if (!runner) {
      return false;
    }

    runner.stop();

    const allTasks = this.taskQueue.getAll();
    for (const task of allTasks) {
      if (task.projectName === name && (task.status === 'pending' || task.status === 'blocked')) {
        this.taskQueue.cancel(task.id, 'Project removed');
      }
    }

    this._runningTasks.delete(name);
    this.runners.delete(name);
    this._projects.delete(name);

    this.emit('projectRemoved', { name });
    return true;
  }
}
