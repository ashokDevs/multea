import { readFileSync, writeFileSync } from 'node:fs';
import type { OrchestratorMessage, TaskItem } from '../types.js';

export type AuthMethod = 'api' | 'auth';

export interface PersistedState {
  orchMessages: OrchestratorMessage[];
  tasks: TaskItem[];
  agentSessions: Record<string, boolean>;
  authMethod?: AuthMethod;
}

export function saveState(path: string, state: PersistedState): void {
  try {
    writeFileSync(path, JSON.stringify(state, null, 2));
  } catch {
    // ignore write errors
  }
}

export function loadState(path: string): PersistedState | null {
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

export function getSavedAuthMethod(path: string): AuthMethod | null {
  const state = loadState(path);
  return state?.authMethod ?? null;
}

export function saveAuthMethod(path: string, authMethod: AuthMethod): void {
  const existing = loadState(path);
  const state: PersistedState = existing ?? {
    orchMessages: [],
    tasks: [],
    agentSessions: {},
  };
  state.authMethod = authMethod;
  saveState(path, state);
}
