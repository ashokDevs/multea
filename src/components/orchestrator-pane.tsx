import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { OrchestratorMessage } from '../types.js';
import { loadUserCommands, type SlashCommand } from '../utils/load-user-commands.js';

const LOGO_ART = [
  '█▀▄▀█ █░█ █░░ ▀█▀ █▀▀ ▄▀█',
  '█░▀░█ █▄█ █▄▄ ░█░ ██▄ █▀█',
];

function renderMarkdown(text: string, baseColor?: string, bgColor?: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<Text key={key++} color={baseColor} backgroundColor={bgColor}>{text.slice(lastIndex, match.index)}</Text>);
    }

    if (match[2]) {
      nodes.push(<Text key={key++} bold italic color={baseColor} backgroundColor={bgColor}>{match[2]}</Text>);
    } else if (match[3]) {
      nodes.push(<Text key={key++} bold color={baseColor} backgroundColor={bgColor}>{match[3]}</Text>);
    } else if (match[4]) {
      nodes.push(<Text key={key++} italic color={baseColor} backgroundColor={bgColor}>{match[4]}</Text>);
    } else if (match[5]) {
      nodes.push(<Text key={key++} color="cyan" backgroundColor={bgColor}>{match[5]}</Text>);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(<Text key={key++} color={baseColor} backgroundColor={bgColor}>{text.slice(lastIndex)}</Text>);
  }

  return nodes.length > 0 ? nodes : [<Text key={0} color={baseColor} backgroundColor={bgColor}>{text}</Text>];
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: '/help', description: 'Show available commands', category: 'claude' },
  { name: '/clear', description: 'Clear conversation history', category: 'claude' },
  { name: '/compact', description: 'Summarize and compact conversation', category: 'claude' },
  { name: '/context', description: 'Show current context usage stats', category: 'claude' },
  { name: '/cost', description: 'Show token usage and session stats', category: 'claude' },
  { name: '/model', description: 'Display or change AI model', category: 'claude' },
  { name: '/config', description: 'Show current configuration', category: 'claude' },
  { name: '/auth', description: 'Show or change auth method: /auth [api|auth|reset]', category: 'claude' },
  { name: '/memory', description: 'Show CLAUDE.md memory files', category: 'claude' },
  { name: '/permissions', description: 'Show tool permissions', category: 'claude' },
  { name: '/export', description: 'Export conversation: /export [file]', category: 'claude' },
  { name: '/theme', description: 'Change color theme (not implemented)', category: 'claude' },
  { name: '/vim', description: 'Toggle vim mode (not implemented)', category: 'claude' },

  { name: '/dispatch', description: 'Dispatch: /dispatch <agent> [AFTER:ids] [PRIORITY:lvl] <prompt>', category: 'multitask' },
  { name: '/broadcast', description: 'Send to all agents: /broadcast <prompt>', category: 'multitask' },
  { name: '/status', description: 'Show all agent states', category: 'multitask' },
  { name: '/agents', description: 'List all configured agents', category: 'multitask' },
  { name: '/queue', description: 'Show task queue with dependencies', category: 'multitask' },
  { name: '/task', description: 'Show task details: /task <id>', category: 'multitask' },
  { name: '/cancel', description: 'Cancel task and dependents: /cancel <id>', category: 'multitask' },
  { name: '/stop', description: 'Stop an agent: /stop <agent|all>', category: 'multitask' },
  { name: '/pause', description: 'Pause an agent: /pause <agent|all>', category: 'multitask' },
  { name: '/resume', description: 'Resume an agent: /resume <agent|all>', category: 'multitask' },
  { name: '/focus', description: 'Focus on agent: /focus <agent>', category: 'multitask' },
  { name: '/restart', description: 'Restart an agent: /restart <agent>', category: 'multitask' },

  { name: '/save', description: 'Save current session state', category: 'session' },
  { name: '/load', description: 'Load saved session state', category: 'session' },
  { name: '/reset', description: 'Reset all agents and clear state', category: 'session' },
];

function getAllCommands(projectDir?: string): SlashCommand[] {
  const userCommands = loadUserCommands(projectDir);
  const builtinNames = new Set(BUILTIN_COMMANDS.map((c) => c.name));
  const filteredUserCommands = userCommands.filter((c) => !builtinNames.has(c.name));
  return [...BUILTIN_COMMANDS, ...filteredUserCommands];
}

interface OrchestratorPaneProps {
  messages: OrchestratorMessage[];
  running: boolean;
  focused: boolean;
  scrollOffset?: number;
  onSendMessage: (msg: string) => void;
  onSlashCommand: (command: string, args: string) => void;
  onEditingChange?: (editing: boolean) => void;
  onBlur?: () => void;
}

const LOGO_HEIGHT = 5;
const INPUT_HEIGHT = 3; // prompt + thinking + margin
const COMMAND_BAR_HEIGHT = 1;

function calculateMessageLines(content: string, width: number): number {
  const lines = content.split('\n');
  let totalLines = 0;
  for (const line of lines) {
    totalLines += Math.max(1, Math.ceil((line.length + 2) / width)); // +2 for prefix
  }
  return totalLines + 1; // +1 for margin
}

function getVisibleMessages(
  messages: OrchestratorMessage[],
  availableHeight: number,
  termWidth: number,
  scrollOffset: number
): { visible: OrchestratorMessage[]; hiddenAbove: number; hiddenBelow: number } {
  if (messages.length === 0) {
    return { visible: [], hiddenAbove: 0, hiddenBelow: 0 };
  }

  const endIndex = messages.length - scrollOffset;
  let usedHeight = 0;
  let startIndex = endIndex;

  for (let i = endIndex - 1; i >= 0; i--) {
    const msgLines = calculateMessageLines(messages[i]!.content, termWidth);
    if (usedHeight + msgLines > availableHeight) {
      break;
    }
    usedHeight += msgLines;
    startIndex = i;
  }

  return {
    visible: messages.slice(Math.max(0, startIndex), Math.max(0, endIndex)),
    hiddenAbove: Math.max(0, startIndex),
    hiddenBelow: scrollOffset,
  };
}

function ThinkingIndicator() {
  const [dotCount, setDotCount] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setDotCount((prev) => (prev + 1) % 4);
    }, 400);
    return () => clearInterval(timer);
  }, []);

  const dots = '.'.repeat(dotCount) + ' '.repeat(3 - dotCount);

  return (
    <Box marginTop={1} marginBottom={1}>
      <Text color="yellow"> thinking{dots}</Text>
    </Box>
  );
}

function Divider({ color = 'gray' }: { color?: string }) {
  return (
    <Box width="100%" height={1} overflow="hidden">
      <Text color={color} dimColor>{'─'.repeat(200)}</Text>
    </Box>
  );
}

export function OrchestratorPane({
  messages,
  running,
  focused,
  scrollOffset = 0,
  onSendMessage,
  onSlashCommand,
  onEditingChange,
  onBlur,
}: OrchestratorPaneProps): React.ReactElement {
  const [input, setInput] = useState('');
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 100;
  const termHeight = stdout?.rows ?? 24;

  const availableHeight = Math.max(5, termHeight - LOGO_HEIGHT - INPUT_HEIGHT - COMMAND_BAR_HEIGHT);

  const allCommands = useMemo(() => getAllCommands(process.cwd()), []);

  const editing = focused;

  const prevFocusedRef = React.useRef(focused);
  if (prevFocusedRef.current !== focused) {
    prevFocusedRef.current = focused;
    onEditingChange?.(focused);
  }

  const commandPrefix = input.split(' ')[0] || '';
  const matchingCommands = input.startsWith('/')
    ? allCommands.filter((c) => c.name.toLowerCase().startsWith(commandPrefix.toLowerCase()))
    : [];
  const showSuggestions = editing && input.startsWith('/') && !input.includes(' ') && matchingCommands.length > 0;

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('/')) {
      const spaceIdx = trimmed.indexOf(' ');
      const cmd = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
      const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
      onSlashCommand(cmd, args);
    } else {
      onSendMessage(trimmed);
    }
    setInput('');
  }, [input, onSendMessage, onSlashCommand]);

  useInput((ch, key) => {
    if (!focused) return;

    if (key.escape) {
      if (input === '') {
        onBlur?.();
      } else {
        setInput('');
      }
    } else if (key.return) {
      handleSubmit();
    } else if (key.tab && showSuggestions && matchingCommands.length > 0) {
      setInput(matchingCommands[0]!.name + ' ');
    } else if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
    } else if (ch && !key.ctrl && !key.meta) {
      setInput((prev) => prev + ch);
    }
  });

  const displayMessages = messages.filter((m) => m.role !== 'user');
  const hasAnyMessages = messages.length > 0;
  const { visible, hiddenAbove, hiddenBelow } = getVisibleMessages(
    displayMessages,
    availableHeight,
    termWidth,
    scrollOffset
  );

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box flexDirection="column" alignItems="center" marginBottom={1} marginTop={1}>
        {LOGO_ART.map((line, i) => (
          <Text key={i} color="green">{line}</Text>
        ))}
        <Text dimColor>──── Claude Code Orchestrator ────</Text>
      </Box>

      {hiddenAbove > 0 && (
        <Text dimColor>↑ {hiddenAbove} older messages (j/k to scroll)</Text>
      )}

      <Box flexDirection="column" height={availableHeight} justifyContent="flex-end">
        {!hasAnyMessages ? (
          <Box justifyContent="center" flexGrow={1}>
            <Text dimColor>waiting for your commands, sire</Text>
          </Box>
        ) : (
          visible.map((msg, i) => (
            <Box key={i} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
              {msg.role === 'assistant' ? (
                <Text wrap="wrap">
                  <Text color="green" bold>⏺ </Text>
                  {renderMarkdown(msg.content, 'white')}
                </Text>
              ) : (
                <Box>
                  <Text wrap="wrap" backgroundColor="#333333">
                    <Text color="yellow" dimColor backgroundColor="#333333">* </Text>
                    {renderMarkdown(msg.content, 'yellow', '#333333')}
                  </Text>
                </Box>
              )}
            </Box>
          ))
        )}
      </Box>

      {hiddenBelow > 0 && (
        <Text dimColor>↓ {hiddenBelow} newer messages</Text>
      )}

      {running && <ThinkingIndicator />}

      <Box flexDirection="column">
        <Divider />
        <Text wrap="wrap">
          <Text color={focused ? 'white' : 'gray'}>❯ </Text>
          <Text>{input}{focused ? '█' : ''}</Text>
        </Text>
        <Divider />
      </Box>

      {showSuggestions && matchingCommands.slice(0, 5).map((cmd, idx) => {
        const maxNameWidth = 32;
        const maxDescWidth = 50;
        const paddedName = cmd.name.padEnd(maxNameWidth);
        const truncatedDesc = cmd.description.length > maxDescWidth
          ? cmd.description.slice(0, maxDescWidth - 1) + '…'
          : cmd.description;
        const isUser = cmd.category === 'user';
        const marker = idx === 0 ? '* ' : '  ';

        return (
          <Box key={cmd.name}>
            <Text dimColor>{marker}</Text>
            <Text color="magenta">{paddedName}</Text>
            <Text color="gray">{truncatedDesc}</Text>
            {isUser && <Text color="gray" dimColor> (user)</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
