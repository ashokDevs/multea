import React from 'react';
import { Box, Text } from 'ink';
import type { AgentState, ProjectConfig, TaskItem } from '../types.js';

interface SidebarPaneProps {
  agents: { name: string; state: AgentState }[];
  projects: ProjectConfig[];
  tasks: readonly TaskItem[];
  focused: boolean;
  selectedAgentIndex: number;
}

const STATE_COLORS: Record<AgentState, string> = {
  idle: 'yellow',
  running: 'green',
  done: 'blue',
  error: 'red',
  paused: 'magenta',
};

const STATE_ICONS: Record<AgentState, string> = {
  idle: '○',
  running: '●',
  done: '✓',
  error: '✗',
  paused: '‖',
};

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  blocked: '◌',
  running: '●',
  done: '✓',
  error: '✗',
  cancelled: '⊘',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'yellow',
  blocked: 'magenta',
  running: 'green',
  done: 'blue',
  error: 'red',
  cancelled: 'gray',
};

export function SidebarPane({
  agents,
  projects,
  tasks,
  focused,
  selectedAgentIndex,
}: SidebarPaneProps) {
  const projectMap = new Map(projects.map((p) => [p.name, p.path]));

  const runningTasks = tasks.filter((t) => t.status === 'running');
  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const blockedTasks = tasks.filter((t) => t.status === 'blocked');
  const doneTasks = tasks.filter((t) => t.status === 'done').slice(-3);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? 'green' : 'gray'}
      paddingX={1}
      flexGrow={1}
    >
      <Box marginBottom={1}>
        <Text bold color={focused ? 'green' : 'white'}>
          Sessions{' '}
        </Text>
        <Text dimColor>
          ({agents.filter((a) => a.state === 'running').length}/{agents.length} active)
        </Text>
      </Box>

      {agents.map((agent, i) => {
        const selected = focused && i === selectedAgentIndex;
        const prefix = selected ? '› ' : '  ';
        const dir = projectMap.get(agent.name) ?? '';
        const shortDir = dir.split('/').pop() ?? dir;

        return (
          <Box key={agent.name}>
            <Text
              bold={selected}
              color={selected ? 'white' : undefined}
              dimColor={agent.state === 'done'}
              wrap="truncate"
            >
              {prefix}
              <Text color={STATE_COLORS[agent.state]}>{STATE_ICONS[agent.state]}</Text>
              {' '}{agent.name}
              <Text dimColor> {shortDir}</Text>
            </Text>
          </Box>
        );
      })}

      <Box marginY={1}>
        <Text dimColor>{'─'.repeat(20)}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text bold color="white">
          Tasks{' '}
        </Text>
        <Text dimColor>
          ({runningTasks.length} running, {pendingTasks.length + blockedTasks.length} queued)
        </Text>
      </Box>

      {runningTasks.map((task) => (
        <Box key={task.id}>
          <Text color="green" wrap="truncate">
            {'  '}{STATUS_ICONS.running} #{task.id} [{task.projectName}]
          </Text>
        </Box>
      ))}

      {pendingTasks.slice(0, 3).map((task) => (
        <Box key={task.id}>
          <Text color="yellow" wrap="truncate">
            {'  '}{STATUS_ICONS.pending} #{task.id} [{task.projectName}]
          </Text>
        </Box>
      ))}
      {pendingTasks.length > 3 && (
        <Text dimColor>{'  '}+{pendingTasks.length - 3} more pending</Text>
      )}

      {blockedTasks.slice(0, 2).map((task) => (
        <Box key={task.id}>
          <Text color="magenta" wrap="truncate">
            {'  '}{STATUS_ICONS.blocked} #{task.id} (blocked)
          </Text>
        </Box>
      ))}
      {blockedTasks.length > 2 && (
        <Text dimColor>{'  '}+{blockedTasks.length - 2} more blocked</Text>
      )}

      {doneTasks.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Recent:</Text>
          {doneTasks.map((task) => (
            <Box key={task.id}>
              <Text dimColor wrap="truncate">
                {'  '}{STATUS_ICONS.done} #{task.id} [{task.projectName}]
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {tasks.length === 0 && (
        <Text dimColor>{'  '}No tasks in queue</Text>
      )}
    </Box>
  );
}
