import React from 'react';
import { Box, Text } from 'ink';
import type { AgentState, ProjectConfig } from '../types.js';

interface SessionsPaneProps {
  agents: { name: string; state: AgentState }[];
  projects: ProjectConfig[];
  focused: boolean;
  selectedIndex: number;
  onRequestAdd?: () => void;
  onRequestRemove?: (name: string) => void;
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

export function SessionsPane({ agents, projects, focused, selectedIndex }: SessionsPaneProps) {
  const projectMap = new Map(projects.map((p) => [p.name, p.path]));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? 'green' : 'gray'}
      paddingX={1}
      flexGrow={1}
    >
      <Text bold color={focused ? 'green' : 'white'}>
        Sessions
      </Text>
      {agents.length === 0 ? (
        <Text dimColor>  No workspaces added</Text>
      ) : (
        agents.map((agent, i) => {
          const selected = focused && i === selectedIndex;
          const prefix = selected ? '› ' : '  ';
          const dir = projectMap.get(agent.name) ?? '';
          const shortDir = dir.split('/').slice(-2).join('/');
          return (
            <Box key={agent.name} flexDirection="column">
              <Text
                bold={selected}
                color={selected ? 'white' : undefined}
                dimColor={agent.state === 'done'}
                wrap="truncate"
              >
                {prefix}
                <Text color={STATE_COLORS[agent.state]}>{STATE_ICONS[agent.state]}</Text>
                {' '}{agent.name}
              </Text>
              <Text dimColor wrap="truncate">
                {'    '}{shortDir}
              </Text>
            </Box>
          );
        })
      )}
      {focused && (
        <Box marginTop={1}>
          <Text dimColor>[a] add  [d] remove</Text>
        </Box>
      )}
    </Box>
  );
}
