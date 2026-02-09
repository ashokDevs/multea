export type AgentState = 'idle' | 'running' | 'done' | 'error' | 'paused';

export interface ProjectConfig {
  name: string;
  path: string;
}

export interface MulteaConfig {
  projects: ProjectConfig[];
  initialTasks?: TaskDefinition[];
}

export interface TaskDefinition {
  projectName: string;
  prompt: string;
}

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';
export type TaskStatus = 'pending' | 'blocked' | 'running' | 'done' | 'error' | 'cancelled';

export interface TaskItem {
  id: string;
  projectName: string;
  prompt: string;
  status: TaskStatus;
  priority: TaskPriority;

  /** Task IDs that must complete successfully before this task can run */
  dependsOn: string[];
  /** Task IDs that are waiting for this task to complete */
  blockedBy: string[];

  /** Timestamps for tracking */
  createdAt: number;
  startedAt?: number;
  completedAt?: number;

  /** Result summary after completion */
  result?: string;
  /** Error message if failed */
  error?: string;

  /** Tags for filtering/grouping */
  tags?: string[];
}

export interface AgentOutput {
  type: 'text' | 'tool_use' | 'tool_result' | 'system' | 'error' | 'thinking';
  content: string;
  timestamp: number;
  /** Tool name if type is 'tool_use' */
  toolName?: string;
  /** Tool call ID for correlating use/result */
  toolCallId?: string;
}

/** SDK-related types for better type safety */
export interface SDKQueryOptions {
  cwd?: string;
  maxTurns?: number;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  allowedTools?: string[];
  resume?: string;
  systemPrompt?: string;
}

export interface OrchestratorMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface DispatchCommand {
  agentName: string;
  prompt: string;
  /** Task IDs that must complete before this task runs */
  dependsOn?: string[];
  /** Priority level */
  priority?: TaskPriority;
  /** Tags for categorization */
  tags?: string[];
}
