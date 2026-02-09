import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export type PanelId = 'agents' | 'orch' | 'questions';

interface CommandBarProps {
  focusedAgent: string;
  agentNames: string[];
  activePanel: PanelId;
  onSendPrompt: (agentName: string, prompt: string) => void;
  onQuit: () => void;
  onStopAgent: (name: string) => void;
  onTogglePause: (agentName: string) => void;
  onSetPanel: (panel: PanelId) => void;
  onNavigate: (delta: number) => void;
  onToggleHelp: () => void;
  onAddWorkspace?: () => void;
  onRemoveWorkspace?: (name: string) => void;
  orchEditing: boolean;
}

const PANELS: PanelId[] = ['agents', 'orch', 'questions'];

export function CommandBar({
  focusedAgent,
  agentNames,
  activePanel,
  onSendPrompt,
  onQuit,
  onStopAgent,
  onTogglePause,
  onSetPanel,
  onNavigate,
  onToggleHelp,
  onAddWorkspace,
  onRemoveWorkspace,
  orchEditing,
}: CommandBarProps) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'normal' | 'agent-input'>('normal');

  useInput((ch, key) => {
    if (orchEditing || activePanel === 'orch') return;

    if (mode === 'normal') {
      if (ch === 'q') {
        onQuit();
      } else if (ch === '1') {
        onSetPanel('agents');
      } else if (ch === '2') {
        onSetPanel('orch');
      } else if (ch === '3') {
        onSetPanel('questions');
      } else if (ch === 'h') {
        const idx = PANELS.indexOf(activePanel);
        if (idx > 0) onSetPanel(PANELS[idx - 1]!);
      } else if (ch === 'l') {
        const idx = PANELS.indexOf(activePanel);
        if (idx < PANELS.length - 1) onSetPanel(PANELS[idx + 1]!);
      } else if (ch === 'j') {
        onNavigate(1);
      } else if (ch === 'k') {
        onNavigate(-1);
      } else if (ch === '[') {
        const idx = PANELS.indexOf(activePanel);
        onSetPanel(PANELS[(idx - 1 + PANELS.length) % PANELS.length]!);
      } else if (ch === ']') {
        const idx = PANELS.indexOf(activePanel);
        onSetPanel(PANELS[(idx + 1) % PANELS.length]!);
      } else if (key.return) {
        onSetPanel('orch');
      } else if (ch === 'x') {
        onStopAgent(focusedAgent);
      } else if (ch === 'p') {
        onTogglePause(focusedAgent);
      } else if (ch === '?') {
        onToggleHelp();
      } else if (ch === 'a' && activePanel === 'agents') {
        onAddWorkspace?.();
      } else if (ch === 'd' && activePanel === 'agents' && focusedAgent) {
        onRemoveWorkspace?.(focusedAgent);
      }
    } else {
      // agent-input mode
      if (key.escape) {
        setMode('normal');
        setInput('');
      } else if (key.return) {
        if (input.trim()) {
          onSendPrompt(focusedAgent, input.trim());
        }
        setMode('normal');
        setInput('');
      } else if (key.backspace || key.delete) {
        setInput((prev) => prev.slice(0, -1));
      } else if (ch && !key.ctrl && !key.meta) {
        setInput((prev) => prev + ch);
      }
    }
  });

  return (
    <Box paddingX={1} flexDirection="column">
      {mode === 'normal' ? (
        <Text dimColor>
          <Text color="cyan">[1]</Text> sessions{' '}
          <Text color="cyan">[2]</Text> orch{' '}
          <Text color="cyan">[3]</Text> questions{' '}
          | <Text color="cyan">[h/l]</Text> panels{' '}
          <Text color="cyan">[j/k]</Text> navigate{' '}
          <Text color="cyan">[?]</Text> help{' '}
          <Text color="cyan">[q]</Text> quit
        </Text>
      ) : (
        <Box>
          <Text color="cyan">{focusedAgent} &gt; </Text>
          <Text>{input}</Text>
          <Text dimColor>_</Text>
          <Text dimColor>  [Enter] send | [Esc] cancel</Text>
        </Box>
      )}
    </Box>
  );
}
