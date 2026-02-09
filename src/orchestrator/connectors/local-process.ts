/**
 * LocalProcessConnector - runs shell commands in workspace directory
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Connector, ConnectorContext, RunHandle } from './types.js';
import type { TaskSpec, ExitResult, ShellAction } from '../core/types.js';

class LocalProcessRunHandle implements RunHandle {
  readonly runId: string;
  private process: ChildProcess | null = null;
  private _isRunning = true;
  private _result: ExitResult | null = null;
  private resolvers: Array<(result: ExitResult) => void> = [];
  private startTime: number;

  // Output buffers
  private stdoutChunks: string[] = [];
  private stderrChunks: string[] = [];

  constructor(
    runId: string,
    private ctx: ConnectorContext,
    private spec: TaskSpec,
    private action: ShellAction
  ) {
    this.runId = runId;
    this.startTime = Date.now();
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  async start(): Promise<void> {
    const { workspace, events, signal, parentSpanId } = this.ctx;
    const { command, args = [], shell = true } = this.action;

    const spanId = randomUUID();
    events.spanStart({
      spanId,
      name: `shell:${command}`,
      parentId: parentSpanId,
      attrs: {
        command,
        args,
        cwd: workspace.rootPath,
      },
    });

    // Merge environment
    const env = {
      ...process.env,
      ...workspace.env,
      ...this.spec.env,
    };

    try {
      this.process = spawn(command, args, {
        cwd: workspace.rootPath,
        env,
        shell,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Handle stdout
      this.process.stdout?.on('data', (chunk: Buffer) => {
        const data = chunk.toString();
        this.stdoutChunks.push(data);
        events.taskOutput({ taskId: this.spec.id, runId: this.runId, stream: 'stdout', data });
        events.spanLog({ spanId, level: 'debug', message: data.trim() });
      });

      // Handle stderr
      this.process.stderr?.on('data', (chunk: Buffer) => {
        const data = chunk.toString();
        this.stderrChunks.push(data);
        events.taskOutput({ taskId: this.spec.id, runId: this.runId, stream: 'stderr', data });
        events.spanLog({ spanId, level: 'warn', message: data.trim() });
      });

      // Handle completion
      this.process.on('close', (code, sig) => {
        this._isRunning = false;
        const durationMs = Date.now() - this.startTime;

        this._result = {
          code: code ?? (sig ? 1 : 0),
          signal: sig ?? undefined,
          stdout: this.stdoutChunks.join(''),
          stderr: this.stderrChunks.join(''),
          durationMs,
        };

        const status = code === 0 ? 'ok' : 'error';
        events.spanEnd({ spanId, status, error: code !== 0 ? `Exit code: ${code}` : undefined, durationMs });

        // Resolve all waiters
        for (const resolve of this.resolvers) {
          resolve(this._result);
        }
        this.resolvers = [];
      });

      // Handle errors
      this.process.on('error', (err) => {
        this._isRunning = false;
        const durationMs = Date.now() - this.startTime;

        this._result = {
          code: 1,
          error: err,
          stdout: this.stdoutChunks.join(''),
          stderr: this.stderrChunks.join(''),
          durationMs,
        };

        events.spanEnd({ spanId, status: 'error', error: err.message, durationMs });

        for (const resolve of this.resolvers) {
          resolve(this._result);
        }
        this.resolvers = [];
      });

      // Handle abort signal
      signal.addEventListener('abort', () => {
        this.cancel();
      });

      // Handle timeout
      if (this.spec.timeoutMs) {
        setTimeout(() => {
          if (this._isRunning) {
            events.spanLog({ spanId, level: 'warn', message: `Task timed out after ${this.spec.timeoutMs}ms` });
            this.cancel();
          }
        }, this.spec.timeoutMs);
      }
    } catch (err) {
      this._isRunning = false;
      const durationMs = Date.now() - this.startTime;

      this._result = {
        code: 1,
        error: err instanceof Error ? err : new Error(String(err)),
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
    if (this.process && this._isRunning) {
      this.process.kill('SIGTERM');
      // Force kill after 5 seconds
      setTimeout(() => {
        if (this._isRunning && this.process) {
          this.process.kill('SIGKILL');
        }
      }, 5_000);
    }
  }
}

export class LocalProcessConnector implements Connector {
  readonly name = 'local-process';

  canHandle(spec: TaskSpec): boolean {
    return spec.action.type === 'shell';
  }

  async start(ctx: ConnectorContext, spec: TaskSpec): Promise<RunHandle> {
    if (spec.action.type !== 'shell') {
      throw new Error(`LocalProcessConnector cannot handle action type: ${spec.action.type}`);
    }

    const runId = randomUUID();
    const handle = new LocalProcessRunHandle(runId, ctx, spec, spec.action);
    await handle.start();
    return handle;
  }
}
