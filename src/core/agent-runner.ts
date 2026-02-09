import { EventEmitter } from 'node:events';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentState, AgentOutput } from '../types.js';
import { buildSdkEnv } from './sdk-env.js';

export interface AgentRunnerEvents {
  output: [AgentOutput];
  stateChange: [AgentState];
  done: [{ success: boolean }];
}

const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'Task',
  'TodoRead',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
];

export class AgentRunner extends EventEmitter<AgentRunnerEvents> {
  readonly name: string;
  readonly cwd: string;
  private authMethod: 'api' | 'auth';

  private _state: AgentState = 'idle';
  private _outputBuffer: AgentOutput[] = [];
  private _sessionId: string | undefined;
  private _hasSession = false;
  private _abortController: AbortController | null = null;
  private _isPaused = false;
  private _pausePromise: Promise<void> | null = null;
  private _pauseResolve: (() => void) | null = null;

  constructor(name: string, cwd: string, authMethod: 'api' | 'auth' = 'auth') {
    super();
    this.name = name;
    this.cwd = cwd;
    this.authMethod = authMethod;
  }

  get state(): AgentState {
    return this._state;
  }

  get hasSession(): boolean {
    return this._hasSession;
  }

  set hasSessionFlag(v: boolean) {
    this._hasSession = v;
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  get outputBuffer(): readonly AgentOutput[] {
    return this._outputBuffer;
  }

  private setState(s: AgentState) {
    this._state = s;
    this.emit('stateChange', s);
  }

  private pushOutput(output: AgentOutput) {
    this._outputBuffer.push(output);
    if (this._outputBuffer.length > 500) {
      this._outputBuffer = this._outputBuffer.slice(-300);
    }
    this.emit('output', output);
  }

  start(): void {
    // No-op — sessions are per-prompt with the SDK
  }

  pause(): void {
    if (this._state === 'running' && !this._isPaused) {
      this._isPaused = true;
      this._pausePromise = new Promise((resolve) => {
        this._pauseResolve = resolve;
      });
      this.setState('paused');
      this.pushOutput({
        type: 'system',
        content: 'Agent paused',
        timestamp: Date.now(),
      });
    }
  }

  resume(): void {
    if (this._state === 'paused' && this._isPaused) {
      this._isPaused = false;
      if (this._pauseResolve) {
        this._pauseResolve();
        this._pauseResolve = null;
        this._pausePromise = null;
      }
      this.setState('running');
      this.pushOutput({
        type: 'system',
        content: 'Agent resumed',
        timestamp: Date.now(),
      });
    }
  }

  async sendPrompt(prompt: string): Promise<void> {
    if (this._state === 'running') {
      this.pushOutput({
        type: 'system',
        content: `Agent busy — ignoring: ${prompt}`,
        timestamp: Date.now(),
      });
      return;
    }

    this.setState('running');
    this.pushOutput({ type: 'system', content: `> ${prompt}`, timestamp: Date.now() });

    this._abortController = new AbortController();

    try {
      const options: Record<string, unknown> = {
        cwd: this.cwd,
        maxTurns: 100,
        permissionMode: 'bypassPermissions' as const,
        allowDangerouslySkipPermissions: true,
        allowedTools: DEFAULT_ALLOWED_TOOLS,
        env: buildSdkEnv(this.authMethod),
      };

      if (this._sessionId) {
        options.resume = this._sessionId;
      }

      const queryStream = query({
        prompt,
        options,
      });

      for await (const message of queryStream) {
        if (this._abortController?.signal.aborted) {
          this.pushOutput({
            type: 'system',
            content: 'Task aborted',
            timestamp: Date.now(),
          });
          break;
        }

        if (this._isPaused && this._pausePromise) {
          await this._pausePromise;
        }

        switch (message.type) {
          case 'system':
            if (message.subtype === 'init') {
              this._sessionId = message.session_id;
              this._hasSession = true;
              this.pushOutput({
                type: 'system',
                content: `Session: ${message.session_id.slice(0, 8)}... | Model: ${message.model}`,
                timestamp: Date.now(),
              });
            }
            break;

          case 'assistant': {
            const content = message.message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  this.pushOutput({
                    type: 'text',
                    content: block.text,
                    timestamp: Date.now(),
                  });
                } else if (block.type === 'tool_use') {
                  this.pushOutput({
                    type: 'tool_use',
                    content: `${block.name}: ${JSON.stringify(block.input).slice(0, 100)}...`,
                    timestamp: Date.now(),
                  });
                }
              }
            }
            break;
          }

          case 'user':
            // Tool results from Claude's tool use
            if (message.message?.content) {
              const content = message.message.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_result') {
                    const resultText = typeof block.content === 'string'
                      ? block.content.slice(0, 200)
                      : JSON.stringify(block.content).slice(0, 200);
                    this.pushOutput({
                      type: 'tool_result',
                      content: `Tool result: ${resultText}${resultText.length >= 200 ? '...' : ''}`,
                      timestamp: Date.now(),
                    });
                  }
                }
              }
            }
            break;

          case 'result':
            if (message.subtype === 'success') {
              this._sessionId = message.session_id;
              this.pushOutput({
                type: 'system',
                content: `Task complete. Cost: $${message.total_cost_usd?.toFixed(4) ?? '0'} | Turns: ${message.num_turns}`,
                timestamp: Date.now(),
              });
              this.setState('done');
              this.emit('done', { success: true });
            } else {
              const errors = (message as { errors?: string[] }).errors ?? [];
              this.pushOutput({
                type: 'error',
                content: `Task failed: ${message.subtype}${errors.length > 0 ? ' - ' + errors.join(', ') : ''}`,
                timestamp: Date.now(),
              });
              this.setState('error');
              this.emit('done', { success: false });
            }
            return; // Exit the loop on result
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.pushOutput({
        type: 'error',
        content: `SDK Error: ${errorMessage}`,
        timestamp: Date.now(),
      });
      this.setState('error');
      this.emit('done', { success: false });
    } finally {
      this._abortController = null;
    }
  }

  abort() {
    if (this._abortController) {
      this._abortController.abort();
    }
    this._isPaused = false;
    this._pauseResolve?.();
    this._pauseResolve = null;
    this._pausePromise = null;
    this.setState('idle');
  }

  stop() {
    this.abort();
  }

  reset() {
    this.abort();
    this._outputBuffer = [];
    this._sessionId = undefined;
    this._hasSession = false;
    this.setState('idle');
  }
}
