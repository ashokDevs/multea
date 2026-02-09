import { randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Connector, ConnectorContext, RunHandle, PendingQuestion } from './types.js';
import type { TaskSpec, ExitResult, ClaudeAgentAction } from '../core/types.js';

const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'Task',
  'WebFetch',
];

function detectQuestion(text: string): { isQuestion: boolean; question: string } {
  const lines = text.trim().split('\n');
  const lastFewLines = lines.slice(-5).join('\n');

  const questionPatterns = [
    /\?[\s]*$/,
    /^(Would you|Could you|Should I|Do you|Is this|Are you|Can you|May I)/im,
    /please (confirm|let me know|respond|answer)/i,
    /(which option|what would you|how should)/i,
    /\b(yes or no|y\/n)\b/i,
    /waiting for (your|user) (input|response|confirmation)/i,
  ];

  for (const pattern of questionPatterns) {
    if (pattern.test(lastFewLines)) {
      const paragraphs = text.trim().split(/\n\n+/);
      const questionPart = paragraphs[paragraphs.length - 1] || lastFewLines;
      return { isQuestion: true, question: questionPart.trim() };
    }
  }

  return { isQuestion: false, question: '' };
}

class ClaudeAgentRunHandle implements RunHandle {
  readonly runId: string;
  private _isRunning = true;
  private _result: ExitResult | null = null;
  private resolvers: Array<(result: ExitResult) => void> = [];
  private startTime: number;
  private aborted = false;
  private outputChunks: string[] = [];
  private _sessionId: string | undefined;
  private _pendingQuestion: PendingQuestion | undefined;
  private resumePromise: Promise<void> | null = null;
  private resumeResolve: (() => void) | null = null;

  constructor(
    runId: string,
    private ctx: ConnectorContext,
    private spec: TaskSpec,
    private action: ClaudeAgentAction,
    private resumeSessionId?: string,
    private resumeAnswer?: string
  ) {
    this.runId = runId;
    this.startTime = Date.now();
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  get hasPendingQuestion(): boolean {
    return this._pendingQuestion !== undefined;
  }

  get pendingQuestion(): PendingQuestion | undefined {
    return this._pendingQuestion;
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  async start(): Promise<void> {
    const { workspace, events, signal, parentSpanId } = this.ctx;
    const { prompt, maxTurns = 50, allowedTools = DEFAULT_ALLOWED_TOOLS } = this.action;

    const spanId = randomUUID();
    events.spanStart({
      spanId,
      name: `claude:${this.spec.name}`,
      parentId: parentSpanId,
      attrs: {
        prompt: prompt.slice(0, 100),
        workspace: workspace.name,
        maxTurns,
        isResume: !!this.resumeSessionId,
      },
    });

    signal.addEventListener('abort', () => {
      this.aborted = true;
    });

    try {
      const options: Record<string, unknown> = {
        cwd: workspace.rootPath,
        maxTurns,
        permissionMode: 'bypassPermissions',
        allowedTools,
      };

      if (this.resumeSessionId) {
        options.resume = this.resumeSessionId;
        events.spanLog({ spanId, level: 'info', message: `Resuming session: ${this.resumeSessionId.slice(0, 8)}` });
      }

      const effectivePrompt = this.resumeAnswer ?? prompt;
      const queryStream = query({ prompt: effectivePrompt, options });
      let totalCost = 0;

      for await (const message of queryStream) {
        if (this.aborted) {
          events.spanLog({ spanId, level: 'info', message: 'Task aborted' });
          break;
        }

        switch (message.type) {
          case 'system':
            if (message.subtype === 'init') {
              this._sessionId = message.session_id;
              events.spanLog({ spanId, level: 'debug', message: `Session started: ${this._sessionId?.slice(0, 8)}` });
            }
            break;

          case 'assistant': {
            const content = message.message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  this.outputChunks.push(block.text);
                  events.taskOutput({ taskId: this.spec.id, runId: this.runId, stream: 'combined', data: block.text });
                  events.spanLog({ spanId, level: 'info', message: block.text.slice(0, 200) });

                  const { isQuestion, question } = detectQuestion(block.text);
                  if (isQuestion && this._sessionId) {
                    this._pendingQuestion = {
                      question,
                      sessionId: this._sessionId,
                      timestamp: Date.now(),
                      context: this.outputChunks.slice(-3).join('\n'),
                    };
                    events.spanLog({ spanId, level: 'info', message: `Question detected: ${question.slice(0, 100)}` });

                    events.emit({
                      type: 'task:question',
                      eventId: randomUUID(),
                      timestamp: Date.now(),
                      taskId: this.spec.id,
                      runId: this.runId,
                      question,
                      sessionId: this._sessionId,
                    });
                  }
                } else if (block.type === 'tool_use') {
                  // Tool use clears pending question -- agent is doing work, not waiting for input
                  this._pendingQuestion = undefined;
                  events.spanLog({ spanId, level: 'debug', message: `Tool: ${block.name}` });
                }
              }
            }
            break;
          }

          case 'result': {
            const durationMs = Date.now() - this.startTime;
            this._isRunning = false;
            this._pendingQuestion = undefined;

            if (message.subtype === 'success') {
              totalCost = message.total_cost_usd ?? 0;

              this._result = {
                code: 0,
                output: message.result || this.outputChunks.join('\n'),
                durationMs,
              };

              events.spanLog({ spanId, level: 'info', message: `Completed. Cost: $${totalCost.toFixed(4)}` });
              events.spanEnd({ spanId, status: 'ok', error: undefined, durationMs });
            } else {
              const errors = (message as { errors?: string[] }).errors ?? [];
              this._result = {
                code: 1,
                output: this.outputChunks.join('\n'),
                stderr: errors.join('\n'),
                error: new Error(message.subtype),
                durationMs,
              };

              events.spanEnd({ spanId, status: 'error', error: message.subtype, durationMs });
            }

            for (const resolve of this.resolvers) {
              resolve(this._result);
            }
            this.resolvers = [];
            return;
          }
        }
      }

      if (!this._result) {
        const durationMs = Date.now() - this.startTime;
        this._isRunning = false;

        this._result = {
          code: this.aborted ? 130 : 1, // 130 = SIGINT
          output: this.outputChunks.join('\n'),
          durationMs,
        };

        events.spanEnd({ spanId, status: this.aborted ? 'canceled' : 'error', error: undefined, durationMs });

        for (const resolve of this.resolvers) {
          resolve(this._result);
        }
        this.resolvers = [];
      }
    } catch (err) {
      const durationMs = Date.now() - this.startTime;
      this._isRunning = false;

      this._result = {
        code: 1,
        error: err instanceof Error ? err : new Error(String(err)),
        output: this.outputChunks.join('\n'),
        durationMs,
      };

      events.spanEnd({ spanId, status: 'error', error: String(err), durationMs });

      for (const resolve of this.resolvers) {
        resolve(this._result);
      }
    }
  }

  wait(): Promise<ExitResult> {
    if (this._result) {
      return Promise.resolve(this._result);
    }

    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  cancel(): void {
    this.aborted = true;
    this._pendingQuestion = undefined;
  }

  async resume(answer: string): Promise<void> {
    if (!this._sessionId) {
      throw new Error('Cannot resume: no session ID');
    }
    if (!this._pendingQuestion) {
      throw new Error('Cannot resume: no pending question');
    }

    this._pendingQuestion = undefined;

    const newHandle = new ClaudeAgentRunHandle(
      this.runId,
      this.ctx,
      this.spec,
      this.action,
      this._sessionId,
      answer
    );

    newHandle.outputChunks = [...this.outputChunks];
    await newHandle.start();
  }
}

export class ClaudeAgentConnector implements Connector {
  readonly name = 'claude-agent';

  canHandle(spec: TaskSpec): boolean {
    return spec.action.type === 'claude-agent';
  }

  async start(ctx: ConnectorContext, spec: TaskSpec): Promise<RunHandle> {
    if (spec.action.type !== 'claude-agent') {
      throw new Error(`ClaudeAgentConnector cannot handle action type: ${spec.action.type}`);
    }

    const runId = randomUUID();
    const handle = new ClaudeAgentRunHandle(runId, ctx, spec, spec.action);

    handle.start().catch(() => {});

    return handle;
  }

  async resume(
    ctx: ConnectorContext,
    spec: TaskSpec,
    sessionId: string,
    answer: string
  ): Promise<RunHandle> {
    if (spec.action.type !== 'claude-agent') {
      throw new Error(`ClaudeAgentConnector cannot handle action type: ${spec.action.type}`);
    }

    const runId = randomUUID();
    const handle = new ClaudeAgentRunHandle(
      runId,
      ctx,
      spec,
      spec.action,
      sessionId,
      answer
    );

    handle.start().catch(() => {});

    return handle;
  }
}
