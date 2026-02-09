import React from 'react';
import { Box, Text } from 'ink';

interface HelpPopupProps {
  onClose: () => void;
}

const BINDINGS = [
  ['1 / 2 / 3', 'Jump to Agents / Tasks / Orchestrator panel'],
  ['4', 'Jump to Output panel'],
  ['h / l', 'Move focus between left and right panels'],
  ['j / k', 'Navigate within focused panel'],
  ['[ / ]', 'Cycle through panels'],
  ['i / Enter', 'Send prompt to selected agent'],
  ['o', 'Send message to orchestrator'],
  ['x', 'Stop selected agent'],
  ['p', 'Pause/resume selected agent'],
  ['/', 'Filter/search within current panel'],
  ['?', 'Toggle this help popup'],
  ['Esc', 'Cancel input / go back'],
  ['q', 'Quit'],
];

export function HelpPopup({ onClose }: HelpPopupProps) {
  void onClose;
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="yellow">
        ─ Keybindings ─
      </Text>
      <Text> </Text>
      {BINDINGS.map(([key, desc], i) => (
        <Box key={i}>
          <Box width={16}>
            <Text bold color="green">
              {key}
            </Text>
          </Box>
          <Text>{desc}</Text>
        </Box>
      ))}
      <Text> </Text>
      <Text dimColor>Press ? or Esc to close</Text>
    </Box>
  );
}
