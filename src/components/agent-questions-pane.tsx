import React from 'react';
import { Box, Text } from 'ink';
import type { OrchestratorMessage } from '../types.js';

interface AgentQuestionsPaneProps {
  questions: OrchestratorMessage[];
}

export function AgentQuestionsPane({ questions }: AgentQuestionsPaneProps) {
  const recent = questions.slice(-5);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      height={8}
    >
      <Text bold color="yellow">
        Agent Questions
      </Text>
      {recent.length === 0 ? (
        <Text dimColor>No questions from agents.</Text>
      ) : (
        recent.map((q, i) => (
          <Text key={i} wrap="truncate" color="yellow">
            {q.content}
          </Text>
        ))
      )}
    </Box>
  );
}
