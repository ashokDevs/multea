import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

export interface Question {
  id: string;
  agentName: string;
  question: string;
  sessionId: string;
  timestamp: number;
  status: 'pending' | 'answered';
  answer?: string;
}

interface QuestionsPaneProps {
  questions: Question[];
  focused: boolean;
  selectedIndex: number;
  onSelectQuestion: (index: number) => void;
  onAnswer: (questionId: string, answer: string) => void;
  onDismiss: (questionId: string) => void;
}

export function QuestionsPane({
  questions,
  focused,
  selectedIndex,
  onSelectQuestion,
  onAnswer,
  onDismiss,
}: QuestionsPaneProps) {
  const [answering, setAnswering] = useState(false);
  const [answerText, setAnswerText] = useState('');

  const pendingQuestions = questions.filter((q) => q.status === 'pending');
  const answeredQuestions = questions.filter((q) => q.status === 'answered');
  const currentQuestion = pendingQuestions[selectedIndex];

  const handleSubmitAnswer = useCallback(() => {
    if (currentQuestion && answerText.trim()) {
      onAnswer(currentQuestion.id, answerText.trim());
      setAnswerText('');
      setAnswering(false);
    }
  }, [currentQuestion, answerText, onAnswer]);

  useInput((ch, key) => {
    if (!focused) return;

    if (answering) {
      if (key.escape) {
        setAnswering(false);
        setAnswerText('');
      } else if (key.return) {
        handleSubmitAnswer();
      } else if (key.backspace || key.delete) {
        setAnswerText((prev) => prev.slice(0, -1));
      } else if (ch && !key.ctrl && !key.meta) {
        setAnswerText((prev) => prev + ch);
      }
    } else {
      if (key.upArrow) {
        onSelectQuestion(Math.max(0, selectedIndex - 1));
      } else if (key.downArrow) {
        onSelectQuestion(Math.min(pendingQuestions.length - 1, selectedIndex + 1));
      } else if (key.return || ch === 'a') {
        if (currentQuestion) {
          setAnswering(true);
        }
      } else if (ch === 'd') {
        if (currentQuestion) {
          onDismiss(currentQuestion.id);
        }
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? 'cyan' : 'gray'}
      paddingX={1}
      flexGrow={1}
    >
      <Box marginBottom={1}>
        <Text bold color={focused ? 'cyan' : 'white'}>
          Questions{' '}
        </Text>
        <Text dimColor>
          ({pendingQuestions.length} pending)
        </Text>
      </Box>

      {pendingQuestions.length === 0 ? (
        <Text dimColor>No pending questions</Text>
      ) : (
        <Box flexDirection="column" flexGrow={1}>
          {pendingQuestions.map((q, i) => {
            const selected = i === selectedIndex;
            const prefix = selected ? '› ' : '  ';
            const timeAgo = Math.floor((Date.now() - q.timestamp) / 1000);
            const timeStr = timeAgo < 60 ? `${timeAgo}s` : `${Math.floor(timeAgo / 60)}m`;

            return (
              <Box
                key={q.id}
                flexDirection="column"
                marginBottom={1}
              >
                <Text
                  bold={selected}
                  color={selected ? 'white' : undefined}
                  wrap="truncate"
                >
                  {prefix}
                  <Text color="cyan">[{q.agentName}]</Text>
                  {' '}
                  <Text dimColor>({timeStr} ago)</Text>
                </Text>
                <Text wrap="wrap" color={selected ? 'yellow' : undefined}>
                  {'    '}{q.question.slice(0, 150)}
                  {q.question.length > 150 ? '...' : ''}
                </Text>
              </Box>
            );
          })}

          {answering && currentQuestion && (
            <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
              <Text color="cyan">
                Answering question from {currentQuestion.agentName}:
              </Text>
              <Box>
                <Text color="white">{'> '}</Text>
                <Text>{answerText}</Text>
                <Text>█</Text>
              </Box>
              <Text dimColor>Enter to submit, Esc to cancel</Text>
            </Box>
          )}
        </Box>
      )}

      {answeredQuestions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor bold>Recently Answered:</Text>
          {answeredQuestions.slice(-3).map((q) => (
            <Box key={q.id} flexDirection="column">
              <Text dimColor wrap="truncate">
                {'  '}[{q.agentName}] {q.question.slice(0, 40)}...
              </Text>
              <Text dimColor wrap="truncate">
                {'    '}→ {q.answer?.slice(0, 50)}...
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {focused && !answering && pendingQuestions.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            ↑↓ navigate • a/Enter answer • d dismiss
          </Text>
        </Box>
      )}
    </Box>
  );
}
