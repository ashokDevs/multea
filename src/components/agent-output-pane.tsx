import React from 'react';
import { Box, Text } from 'ink';
import type { AgentOutput } from '../types.js';

interface AgentOutputPaneProps {
  agentName: string;
  output: readonly AgentOutput[];
  focused: boolean;
  scrollOffset?: number;
  maxLines?: number;
}

export function AgentOutputPane({
  agentName,
  output,
  focused,
  scrollOffset = 0,
  maxLines = 40,
}: AgentOutputPaneProps) {
  const end = output.length - scrollOffset;
  const start = Math.max(0, end - maxLines);
  const visibleOutput = output.slice(start, Math.max(end, 0));
  const hiddenAbove = start;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? 'green' : 'gray'}
      paddingX={1}
      flexGrow={1}
    >
      <Text bold color={focused ? 'green' : 'white'}>
        ─ Agent Output ({agentName}) ─
      </Text>
      {hiddenAbove > 0 && scrollOffset > 0 && (
        <Text dimColor>{`↑ ${hiddenAbove + scrollOffset} more`}</Text>
      )}
      <Box flexDirection="column" flexGrow={1}>
        {visibleOutput.length === 0 ? (
          <Text dimColor>No output yet</Text>
        ) : (
          visibleOutput.map((line, i) => (
            <Text
              key={i}
              wrap="end"
              color={line.type === 'error' ? 'red' : undefined}
              dimColor={line.type === 'system'}
            >
              {line.content}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
