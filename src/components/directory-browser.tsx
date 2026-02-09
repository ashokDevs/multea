import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

interface DirectoryBrowserProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
  existingProjects?: string[];
}

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isProject: boolean;
  isExisting: boolean;
}

const WIDTH = 60;
const BG = 'white';
const FG = 'black';

function pad(text: string, width: number = WIDTH - 4): string {
  if (text.length >= width) return text.slice(0, width);
  return text + ' '.repeat(width - text.length);
}

function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return join(homedir(), p.slice(2));
  }
  return resolve(p);
}

function getProjectIndicators(path: string): string[] {
  const indicators: string[] = [];
  try {
    if (existsSync(join(path, '.git'))) indicators.push('git');
    if (existsSync(join(path, 'package.json'))) indicators.push('npm');
    if (existsSync(join(path, 'Cargo.toml'))) indicators.push('rust');
    if (existsSync(join(path, 'go.mod'))) indicators.push('go');
    if (existsSync(join(path, 'pyproject.toml')) || existsSync(join(path, 'setup.py'))) indicators.push('py');
  } catch {
    // Ignore permission errors
  }
  return indicators;
}

function listDirectory(path: string, existingProjects: string[] = []): DirEntry[] {
  try {
    const entries = readdirSync(path);
    const dirs: DirEntry[] = [];

    for (const name of entries) {
      if (name.startsWith('.')) continue;

      const fullPath = join(path, name);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          const indicators = getProjectIndicators(fullPath);
          dirs.push({
            name,
            path: fullPath,
            isDirectory: true,
            isProject: indicators.length > 0,
            isExisting: existingProjects.includes(fullPath),
          });
        }
      } catch {
        // Skip entries we can't stat
      }
    }

    dirs.sort((a, b) => {
      if (a.isProject && !b.isProject) return -1;
      if (!a.isProject && b.isProject) return 1;
      return a.name.localeCompare(b.name);
    });

    return dirs;
  } catch {
    return [];
  }
}

export function DirectoryBrowser({
  initialPath,
  onSelect,
  onCancel,
  existingProjects = [],
}: DirectoryBrowserProps) {
  const [currentPath, setCurrentPath] = useState(expandPath(initialPath || '~/'));
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputMode, setInputMode] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dirs = listDirectory(currentPath, existingProjects);
    setEntries(dirs);
    setSelectedIndex(0);
    setError(null);
  }, [currentPath, existingProjects]);

  const navigateUp = useCallback(() => {
    const parent = dirname(currentPath);
    if (parent !== currentPath) {
      setCurrentPath(parent);
    }
  }, [currentPath]);

  const navigateInto = useCallback((path: string) => {
    if (existsSync(path)) {
      setCurrentPath(path);
    }
  }, []);

  const selectCurrent = useCallback(() => {
    const indicators = getProjectIndicators(currentPath);
    if (indicators.length > 0) {
      onSelect(currentPath);
    } else if (entries[selectedIndex]) {
      const entry = entries[selectedIndex];
      if (entry.isExisting) {
        setError('Project already added');
      } else if (entry.isProject) {
        onSelect(entry.path);
      } else {
        navigateInto(entry.path);
      }
    }
  }, [currentPath, entries, selectedIndex, onSelect, navigateInto]);

  useInput((ch, key) => {
    if (inputMode) {
      if (key.escape) {
        setInputMode(false);
        setInputValue('');
        setError(null);
      } else if (key.return) {
        const expanded = expandPath(inputValue);
        if (existsSync(expanded) && statSync(expanded).isDirectory()) {
          if (existingProjects.includes(expanded)) {
            setError('Project already added');
          } else {
            onSelect(expanded);
          }
        } else {
          setError('Invalid path');
        }
      } else if (key.backspace || key.delete) {
        setInputValue((prev) => prev.slice(0, -1));
        setError(null);
      } else if (ch && !key.ctrl && !key.meta) {
        setInputValue((prev) => prev + ch);
        setError(null);
      }
      return;
    }

    if (key.escape) {
      onCancel();
    } else if (key.upArrow || ch === 'k') {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow || ch === 'j') {
      setSelectedIndex((prev) => Math.min(entries.length - 1, prev + 1));
    } else if (key.backspace || ch === 'h') {
      navigateUp();
    } else if (key.tab || key.rightArrow || ch === 'l') {
      const entry = entries[selectedIndex];
      if (entry && !entry.isExisting) {
        navigateInto(entry.path);
      }
    } else if (key.return) {
      selectCurrent();
    } else if (ch === '/') {
      setInputMode(true);
      setInputValue('');
    }
  });

  const displayPath = currentPath.replace(homedir(), '~');
  const currentIndicators = getProjectIndicators(currentPath);
  const maxVisible = 12;
  const startIndex = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
  const visibleEntries = entries.slice(startIndex, startIndex + maxVisible);

  const Line = ({ children, color }: { children: string; color?: string }) => (
    <Text backgroundColor={BG} color={color || FG}>{pad(children)}</Text>
  );

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" width={WIDTH}>
      <Box>
        <Text backgroundColor={BG} color="blue" bold>{pad('  Add Workspace')}</Text>
      </Box>
      <Box><Line>{''}</Line></Box>

      {(() => {
        const pathStr = displayPath.slice(0, 40);
        const indicatorStr = currentIndicators.length > 0 ? ` [${currentIndicators.join(',')}]` : '';
        const fullLine = `  Path: ${pathStr}${indicatorStr}`;
        const padding = ' '.repeat(Math.max(0, WIDTH - 4 - fullLine.length));
        return (
          <Box>
            <Text backgroundColor={BG}>
              <Text color="gray">{'  Path: '}</Text>
              <Text color="blue" bold>{pathStr}</Text>
              {currentIndicators.length > 0 && (
                <Text color="green">{indicatorStr}</Text>
              )}
              <Text>{padding}</Text>
            </Text>
          </Box>
        );
      })()}
      <Box><Line>{''}</Line></Box>

      {inputMode ? (
        <>
          {(() => {
            const inputStr = inputValue.slice(0, 45);
            const fullLine = `  Paste: ${inputStr}█`;
            const padding = ' '.repeat(Math.max(0, WIDTH - 4 - fullLine.length));
            return (
              <Box>
                <Text backgroundColor={BG}>
                  <Text color={FG}>{'  Paste: '}</Text>
                  <Text color="blue">{inputStr}</Text>
                  <Text color={FG}>{'█'}{padding}</Text>
                </Text>
              </Box>
            );
          })()}
          {error && <Box><Text backgroundColor={BG} color="red">{pad(`  ${error}`)}</Text></Box>}
          <Box><Line>{''}</Line></Box>
          <Box><Text backgroundColor={BG} color="gray">{pad('  [Enter] select  [Esc] cancel')}</Text></Box>
        </>
      ) : (
        <>
          {entries.length === 0 ? (
            <Box><Text backgroundColor={BG} color="gray">{pad('  (empty directory)')}</Text></Box>
          ) : (
            visibleEntries.map((entry, i) => {
              const actualIndex = startIndex + i;
              const isSelected = actualIndex === selectedIndex;
              const indicators = getProjectIndicators(entry.path);
              const prefix = isSelected ? '› ' : '  ';
              const suffix = indicators.length > 0 ? ` [${indicators.join(',')}]` : '';
              const addedSuffix = entry.isExisting ? ' (added)' : '';
              const line = `${prefix}${entry.name}/${suffix}${addedSuffix}`;

              let textColor = FG;
              if (isSelected) textColor = 'blue';
              else if (entry.isExisting) textColor = 'gray';
              else if (entry.isProject) textColor = 'green';

              return (
                <Box key={entry.path}>
                  <Text
                    backgroundColor={BG}
                    color={textColor}
                    bold={isSelected}
                  >
                    {pad(line)}
                  </Text>
                </Box>
              );
            })
          )}
          {entries.length > maxVisible && (
            <Box><Text backgroundColor={BG} color="gray">{pad(`  ... ${entries.length - maxVisible} more`)}</Text></Box>
          )}

          {error && (
            <Box><Text backgroundColor={BG} color="red">{pad(`  ${error}`)}</Text></Box>
          )}

          <Box><Line>{''}</Line></Box>
          <Box><Text backgroundColor={BG} color="gray">{pad('  [↑↓] navigate [Tab] enter [Bksp] up [/] paste')}</Text></Box>
          <Box><Text backgroundColor={BG} color="gray">{pad('  [Enter] select  [Esc] cancel')}</Text></Box>
        </>
      )}
    </Box>
  );
}
