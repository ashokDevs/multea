/**
 * Types for handling agent questions that require user input
 */

import type { TaskId, WorkspaceId } from '../core/types.js';

export type QuestionId = string;
export type SessionId = string;

export type QuestionStatus = 'pending' | 'answered' | 'dismissed' | 'expired';

/**
 * A question from an agent that needs user input
 */
export interface AgentQuestion {
  /** Unique question identifier */
  id: QuestionId;

  /** The task that generated this question */
  taskId: TaskId;

  /** The workspace where the agent is running */
  workspaceId: WorkspaceId;

  /** Session ID from the Claude Agent SDK for resumption */
  sessionId: SessionId;

  /** The question text from the agent */
  question: string;

  /** Current status of the question */
  status: QuestionStatus;

  /** When the question was received */
  createdAt: number;

  /** When the question was answered (if answered) */
  answeredAt?: number;

  /** The user's answer (if answered) */
  answer?: string;

  /** Additional context from the agent output */
  context?: string;

  /** Options if the question is multiple choice */
  options?: string[];
}

/**
 * Options for creating a new question
 */
export interface CreateQuestionOptions {
  taskId: TaskId;
  workspaceId: WorkspaceId;
  sessionId: SessionId;
  question: string;
  context?: string;
  options?: string[];
}

/**
 * Events emitted by the question queue
 */
export type QuestionEvent =
  | { type: 'question:created'; question: AgentQuestion }
  | { type: 'question:answered'; questionId: QuestionId; answer: string }
  | { type: 'question:dismissed'; questionId: QuestionId }
  | { type: 'question:expired'; questionId: QuestionId };
