import { randomUUID } from 'node:crypto';
import type {
  AgentQuestion,
  QuestionId,
  CreateQuestionOptions,
  QuestionEvent,
  QuestionStatus,
} from './types.js';
import type { TaskId } from '../core/types.js';

type QuestionEventHandler = (event: QuestionEvent) => void;

export class QuestionQueue {
  private questions: Map<QuestionId, AgentQuestion> = new Map();
  private handlers: Set<QuestionEventHandler> = new Set();

  on(handler: QuestionEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(event: QuestionEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // handler errors are non-fatal, silently continue
      }
    }
  }

  createQuestion(options: CreateQuestionOptions): AgentQuestion {
    const question: AgentQuestion = {
      id: randomUUID(),
      taskId: options.taskId,
      workspaceId: options.workspaceId,
      sessionId: options.sessionId,
      question: options.question,
      status: 'pending',
      createdAt: Date.now(),
      context: options.context,
      options: options.options,
    };

    this.questions.set(question.id, question);
    this.emit({ type: 'question:created', question });

    return question;
  }

  answer(questionId: QuestionId, answer: string): AgentQuestion | null {
    const question = this.questions.get(questionId);
    if (!question || question.status !== 'pending') {
      return null;
    }

    question.status = 'answered';
    question.answer = answer;
    question.answeredAt = Date.now();

    this.emit({ type: 'question:answered', questionId, answer });

    return question;
  }

  dismiss(questionId: QuestionId): boolean {
    const question = this.questions.get(questionId);
    if (!question || question.status !== 'pending') {
      return false;
    }

    question.status = 'dismissed';
    this.emit({ type: 'question:dismissed', questionId });

    return true;
  }

  expire(questionId: QuestionId): boolean {
    const question = this.questions.get(questionId);
    if (!question || question.status !== 'pending') {
      return false;
    }

    question.status = 'expired';
    this.emit({ type: 'question:expired', questionId });

    return true;
  }

  get(questionId: QuestionId): AgentQuestion | undefined {
    return this.questions.get(questionId);
  }

  getPending(): AgentQuestion[] {
    return Array.from(this.questions.values()).filter(
      (q) => q.status === 'pending'
    );
  }

  getByTask(taskId: TaskId): AgentQuestion[] {
    return Array.from(this.questions.values()).filter(
      (q) => q.taskId === taskId
    );
  }

  getByStatus(status: QuestionStatus): AgentQuestion[] {
    return Array.from(this.questions.values()).filter(
      (q) => q.status === status
    );
  }

  getAll(): AgentQuestion[] {
    return Array.from(this.questions.values());
  }

  get pendingCount(): number {
    return this.getPending().length;
  }

  clear(): void {
    this.questions.clear();
  }

  cleanup(maxAgeMs: number = 36_00_000): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [id, question] of this.questions) {
      if (
        question.status !== 'pending' &&
        (question.answeredAt ?? question.createdAt) < cutoff
      ) {
        this.questions.delete(id);
        removed++;
      }
    }

    return removed;
  }
}
