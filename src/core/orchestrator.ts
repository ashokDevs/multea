import { EventEmitter } from 'node:events';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentManager } from './agent-manager.js';
import type { OrchestratorMessage, DispatchCommand, TaskItem } from '../types.js';
import { buildSdkEnv } from './sdk-env.js';

export interface OrchestratorEvents {
  message: [OrchestratorMessage];
  dispatch: [DispatchCommand[]];
  error: [string];
}

const ORCHESTRATOR_SYSTEM_PROMPT = `You are a multi-agent orchestrator coordinating multiple Claude Code agents working in different git worktrees/projects.

Your role is to:
1. Understand the user's request
2. Break down complex tasks across appropriate agents
3. Coordinate work between agents using task dependencies
4. Track progress and synthesize results

IMPORTANT: When the user asks you to do something, IMMEDIATELY dispatch tasks to agents. Do NOT ask for approval or confirmation — just do it. Act decisively and dispatch right away.

## DISPATCH FORMAT

To send a task to an agent, include this in your response:
[DISPATCH:agent-name] Your prompt/task

To send a task that depends on other tasks completing first:
[DISPATCH:agent-name AFTER:task-1,task-2] Your prompt/task

To set priority (critical, high, normal, low):
[DISPATCH:agent-name PRIORITY:high] Your prompt/task

Combined example:
[DISPATCH:backend AFTER:3,4 PRIORITY:high] Deploy after tests pass

## EXAMPLES

Simple parallel tasks:
[DISPATCH:frontend] Fix the login button styling
[DISPATCH:backend] Add rate limiting to the /api/auth endpoint

Sequential dependent tasks:
[DISPATCH:backend] Write the API endpoint for user profiles
[DISPATCH:frontend AFTER:1] Build the UI to call the new user profiles API
[DISPATCH:tests AFTER:1,2] Write integration tests for the user profiles feature

## GUIDELINES

- ALWAYS include [DISPATCH:...] commands when the user wants work done — never just describe what you would do
- Use AFTER: for tasks that depend on others completing successfully
- Reference tasks by their ID number shown in the task list
- If a dependency task fails, dependent tasks are automatically cancelled
- Higher priority tasks run first when agents are available
- Be concise - dispatch tasks immediately when work is needed
- Only ask clarifying questions if the request is truly ambiguous`;

export class Orchestrator extends EventEmitter<OrchestratorEvents> {
  private manager: AgentManager;
  private authMethod: 'api' | 'auth';
  private _messageHistory: OrchestratorMessage[] = [];
  private _running = false;
  private _sessionId: string | undefined;
  private _abortController: AbortController | null = null;

  constructor(manager: AgentManager, authMethod: 'api' | 'auth' = 'auth') {
    super();
    this.manager = manager;
    this.authMethod = authMethod;
  }

  get messageHistory(): OrchestratorMessage[] {
    return this._messageHistory;
  }

  get running(): boolean {
    return this._running;
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  buildAgentContext(): string {
    const names = this.manager.getAgentNames();
    const states = this.manager.getStates();
    const lines: string[] = [];

    lines.push('## AGENTS');
    for (const name of names) {
      const state = states.get(name) ?? 'idle';
      const runner = this.manager.getAgent(name)!;
      const icon = state === 'running' ? '🟢' : state === 'paused' ? '🟡' : state === 'error' ? '🔴' : '⚪';
      lines.push(`${icon} ${name} (${state}) - ${runner.cwd}`);

      const recentOutput = runner.outputBuffer
        .slice(-3)
        .filter((o) => o.type === 'text')
        .map((o) => o.content.slice(0, 100))
        .join(' | ');

      if (recentOutput) {
        lines.push(`   └─ Recent: ${recentOutput.slice(0, 150)}...`);
      }
    }

    const stats = this.manager.taskQueue.getStats();
    lines.push('');
    lines.push(`## TASKS (${stats.total} total: ${stats.running} running, ${stats.pending} pending, ${stats.blocked} blocked, ${stats.done} done, ${stats.error} error)`);

    const runningTasks = this.manager.taskQueue.getRunning();
    if (runningTasks.length > 0) {
      lines.push('');
      lines.push('### Running:');
      for (const task of runningTasks) {
        lines.push(`  #${task.id} [${task.projectName}] ${task.prompt.slice(0, 60)}...`);
      }
    }

    const pendingTasks = this.manager.taskQueue.getPending();
    if (pendingTasks.length > 0) {
      lines.push('');
      lines.push('### Pending (ready to run):');
      for (const task of pendingTasks.slice(0, 5)) {
        lines.push(`  #${task.id} [${task.projectName}] ${task.prompt.slice(0, 60)}...`);
      }
      if (pendingTasks.length > 5) {
        lines.push(`  ... and ${pendingTasks.length - 5} more`);
      }
    }

    const blockedTasks = this.manager.taskQueue.getBlocked();
    if (blockedTasks.length > 0) {
      lines.push('');
      lines.push('### Blocked (waiting for dependencies):');
      for (const task of blockedTasks.slice(0, 5)) {
        const deps = task.dependsOn.join(', ');
        lines.push(`  #${task.id} [${task.projectName}] waiting for #${deps}: ${task.prompt.slice(0, 40)}...`);
      }
      if (blockedTasks.length > 5) {
        lines.push(`  ... and ${blockedTasks.length - 5} more`);
      }
    }

    const completedTasks = this.manager.taskQueue.getCompleted().slice(-3);
    if (completedTasks.length > 0) {
      lines.push('');
      lines.push('### Recently Completed:');
      for (const task of completedTasks) {
        const icon = task.status === 'done' ? '✓' : '✗';
        const result = task.result ? ` - ${task.result.slice(0, 50)}...` : '';
        lines.push(`  ${icon} #${task.id} [${task.projectName}] ${task.prompt.slice(0, 40)}${result}`);
      }
    }

    return lines.join('\n');
  }

  parseDispatchCommands(content: string): DispatchCommand[] {
    const commands: DispatchCommand[] = [];
    const validNames = new Set(this.manager.getAgentNames());

    const regex = /\[DISPATCH:([^\s\]]+)([^\]]*)\]\s*(.+?)(?=\[DISPATCH:|$)/gs;
    let match;

    while ((match = regex.exec(content)) !== null) {
      const agentName = match[1].trim();
      const options = match[2].trim();
      const prompt = match[3].trim();

      if (!validNames.has(agentName) || !prompt) continue;

      const command: DispatchCommand = { agentName, prompt };

      const afterMatch = options.match(/AFTER:([^\s]+)/i);
      if (afterMatch) {
        command.dependsOn = afterMatch[1].split(',').map((id) => id.trim());
      }

      const priorityMatch = options.match(/PRIORITY:(critical|high|normal|low)/i);
      if (priorityMatch) {
        command.priority = priorityMatch[1].toLowerCase() as 'critical' | 'high' | 'normal' | 'low';
      }

      commands.push(command);
    }

    return commands;
  }

  abort(): void {
    if (this._abortController) {
      this._abortController.abort();
    }
    this._running = false;
  }

  async sendMessage(userMessage: string): Promise<void> {
    if (this._running) return;
    this._running = true;

    const userMsg: OrchestratorMessage = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };
    this._messageHistory.push(userMsg);
    this.emit('message', userMsg);

    this._abortController = new AbortController();

    try {
      const agentContext = this.buildAgentContext();
      const fullPrompt = `${agentContext}\n\n---\n\nUSER: ${userMessage}`;

      // Gather all project directories so the orchestrator can access any repo
      const projectDirs = this.manager.getAgentNames()
        .map((name) => this.manager.getAgent(name)?.cwd)
        .filter((d): d is string => !!d);

      const options: Record<string, unknown> = {
        cwd: process.cwd(),
        additionalDirectories: projectDirs,
        maxTurns: 50,
        permissionMode: 'acceptEdits' as const,
        systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
        env: buildSdkEnv(this.authMethod),
      };

      if (this._sessionId) {
        options.resume = this._sessionId;
      }

      const queryStream = query({
        prompt: fullPrompt,
        options,
      });

      let responseText = '';

      for await (const message of queryStream) {
        if (this._abortController?.signal.aborted) {
          break;
        }

        switch (message.type) {
          case 'system':
            if (message.subtype === 'init') {
              this._sessionId = message.session_id;
            }
            break;

          case 'assistant': {
            const content = message.message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  responseText += block.text;
                }
              }
            }
            break;
          }

          case 'result':
            if (message.subtype === 'success') {
              const finalText = message.result || responseText;

              if (finalText) {
                const assistantMsg: OrchestratorMessage = {
                  role: 'assistant',
                  content: finalText,
                  timestamp: Date.now(),
                };
                this._messageHistory.push(assistantMsg);
                this.emit('message', assistantMsg);

                const commands = this.parseDispatchCommands(finalText);
                if (commands.length > 0) {
                  this.emit('dispatch', commands);
                }
              }
            } else {
              const errors = (message as { errors?: string[] }).errors ?? [];
              const errorMsg: OrchestratorMessage = {
                role: 'assistant',
                content: `Error: ${message.subtype}${errors.length > 0 ? ' - ' + errors.join(', ') : ''}`,
                timestamp: Date.now(),
              };
              this._messageHistory.push(errorMsg);
              this.emit('message', errorMsg);
              this.emit('error', errorMsg.content);
            }
            break;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorMsg: OrchestratorMessage = {
        role: 'assistant',
        content: `SDK Error: ${errorMessage}`,
        timestamp: Date.now(),
      };
      this._messageHistory.push(errorMsg);
      this.emit('message', errorMsg);
      this.emit('error', errorMessage);
    } finally {
      this._running = false;
      this._abortController = null;
    }
  }
}
