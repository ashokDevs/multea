import React from 'react';
import { Box, Text } from 'ink';
import type { TaskItem } from '../types.js';

interface TaskPaneProps {
  tasks: readonly TaskItem[];
  focused: boolean;
  selectedIndex: number;
}

const STATUS_COLORS: Record<TaskItem['status'], string> = {
  pending: 'yellow',
  blocked: 'magenta',
  running: 'green',
  done: 'blue',
  error: 'red',
  cancelled: 'gray',
};

export function TaskPane({ tasks, focused, selectedIndex }: TaskPaneProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? 'green' : 'gray'}
      paddingX={1}
      flexGrow={1}
    >
      <Text bold color={focused ? 'green' : 'white'}>
        ─ 2 Tasks ─
      </Text>
      {tasks.length === 0 ? (
        <Text dimColor>No tasks</Text>
      ) : (
        tasks.map((task, i) => {
          const selected = focused && i === selectedIndex;
          const prefix = selected ? '> ' : '  ';
          return (
            <Text
              key={task.id}
              bold={selected}
              color={selected ? 'white' : undefined}
              dimColor={task.status === 'done'}
              wrap="truncate"
            >
              {prefix}
              <Text color={STATUS_COLORS[task.status]}>[{task.status}]</Text>{' '}
              {task.prompt.slice(0, 30)}
              {task.prompt.length > 30 ? '…' : ''} ({task.projectName})
            </Text>
          );
        })
      )}
    </Box>
  );
}
