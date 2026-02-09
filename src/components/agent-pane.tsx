import React from 'react';
import { Box, Text } from 'ink';
import type { AgentState } from '../types.js';

interface AgentListPaneProps {
  agents: { name: string; state: AgentState }[];
  focused: boolean;
  selectedIndex: number;
}

const STATE_COLORS: Record<AgentState, string> = {
  idle: 'yellow',
  running: 'green',
  done: 'blue',
  error: 'red',
  paused: 'magenta',
};

export function AgentListPane({ agents, focused, selectedIndex }: AgentListPaneProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? 'green' : 'gray'}
      paddingX={1}
      flexGrow={1}
    >
      <Text bold color={focused ? 'green' : 'white'}>
        ─ 1 Agents ─
      </Text>
      {agents.map((agent, i) => {
        const selected = focused && i === selectedIndex;
        const prefix = selected ? '> ' : '  ';
        return (
          <Text
            key={agent.name}
            bold={selected}
            color={selected ? 'white' : undefined}
            dimColor={agent.state === 'done'}
            wrap="truncate"
          >
            {prefix}
            {agent.name}{'  '}
            <Text color={STATE_COLORS[agent.state]}>[{agent.state}]</Text>
          </Text>
        );
      })}
    </Box>
  );
}
