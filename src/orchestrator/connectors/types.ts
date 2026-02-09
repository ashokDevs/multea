/**
 * Connector interface - abstracts how task execution happens
 * Inspired by Dagger's connector pattern
 */

import type { TaskSpec, ExitResult, Workspace } from '../core/types.js';
import type { EventBus } from '../events/event-bus.js';

/**
 * Represents a question from an agent that needs user input
 */
export interface PendingQuestion {
  /** The question text */
  question: string;
  /** Session ID for resuming with the answer */
  sessionId: string;
  /** When the question was asked */
  timestamp: number;
  /** Optional context around the question */
  context?: string;
}

/**
 * Handle to a running task execution
 */
export interface RunHandle {
  /** Unique ID for this execution */
  readonly runId: string;

  /** Wait for execution to complete */
  wait(): Promise<ExitResult>;

  /** Cancel the execution */
  cancel(): void;

  /** Check if execution is still running */
  readonly isRunning: boolean;

  /** Stream stdout (if available) */
  readonly stdout?: AsyncIterable<string>;

  /** Stream stderr (if available) */
  readonly stderr?: AsyncIterable<string>;

  /** Check if there's a pending question */
  readonly hasPendingQuestion?: boolean;

  /** Get the pending question (if any) */
  readonly pendingQuestion?: PendingQuestion;

  /** Resume execution with an answer to the pending question */
  resume?(answer: string): Promise<void>;
}

/**
 * Context provided to connectors
 */
export interface ConnectorContext {
  /** The workspace for execution */
  workspace: Workspace;

  /** Event bus for emitting events */
  events: EventBus;

  /** Abort signal for cancellation */
  signal: AbortSignal;

  /** Parent span ID for tracing */
  parentSpanId?: string;
}

/**
 * Connector interface - all execution goes through connectors
 */
export interface Connector {
  /** Connector name for logging */
  readonly name: string;

  /** Check if this connector can handle the given action type */
  canHandle(spec: TaskSpec): boolean;

  /** Start execution of a task */
  start(ctx: ConnectorContext, spec: TaskSpec): Promise<RunHandle>;

  /** Cleanup any resources (called on shutdown) */
  dispose?(): Promise<void>;
}

/**
 * Registry of connectors
 */
export class ConnectorRegistry {
  private connectors: Map<string, Connector> = new Map();

  register(connector: Connector): void {
    this.connectors.set(connector.name, connector);
  }

  unregister(name: string): void {
    this.connectors.delete(name);
  }

  get(name: string): Connector | undefined {
    return this.connectors.get(name);
  }

  /**
   * Find a connector that can handle the given task spec
   */
  findFor(spec: TaskSpec): Connector | undefined {
    for (const connector of this.connectors.values()) {
      if (connector.canHandle(spec)) {
        return connector;
      }
    }
    return undefined;
  }

  async disposeAll(): Promise<void> {
    for (const connector of this.connectors.values()) {
      if (connector.dispose) {
        await connector.dispose();
      }
    }
    this.connectors.clear();
  }
}
