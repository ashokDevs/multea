import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SlashCommand {
  name: string;
  description: string;
  category: 'claude' | 'multitask' | 'session' | 'user';
  /** Path to the source file for user commands */
  sourcePath?: string;
}

interface ParsedFrontmatter {
  name?: string;
  description?: string;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return {};
  }

  const frontmatter = frontmatterMatch[1]!;
  const result: ParsedFrontmatter = {};

  for (const line of frontmatter.split('\n')) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) {
      result.name = nameMatch[1]!.trim();
    }

    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) {
      result.description = descMatch[1]!.trim();
    }
  }

  return result;
}

function loadCommandsFromDir(dir: string): SlashCommand[] {
  const commands: SlashCommand[] = [];

  if (!fs.existsSync(dir)) {
    return commands;
  }

  try {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (!stat.isFile()) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const frontmatter = parseFrontmatter(content);

      const commandName = path.basename(file, '.md');
      const description = frontmatter.description || content.slice(0, 80).replace(/\n/g, ' ').trim() + '...';

      commands.push({
        name: `/${commandName}`,
        description,
        category: 'user',
        sourcePath: filePath,
      });
    }
  } catch {
    // Silently ignore permission errors or other issues
  }

  return commands;
}

function loadSkillsFromDir(dir: string): SlashCommand[] {
  const commands: SlashCommand[] = [];

  if (!fs.existsSync(dir)) {
    return commands;
  }

  try {
    const entries = fs.readdirSync(dir);

    for (const entry of entries) {
      const skillDir = path.join(dir, entry);
      const stat = fs.statSync(skillDir);

      if (!stat.isDirectory()) continue;

      const skillFile = path.join(skillDir, 'SKILL.md');

      if (!fs.existsSync(skillFile)) continue;

      const content = fs.readFileSync(skillFile, 'utf-8');
      const frontmatter = parseFrontmatter(content);

      const skillName = frontmatter.name || entry;
      const description = frontmatter.description || 'User-defined skill';

      commands.push({
        name: `/${skillName}`,
        description,
        category: 'user',
        sourcePath: skillFile,
      });
    }
  } catch {
    // Silently ignore permission errors or other issues
  }

  return commands;
}

export function loadUserCommands(projectDir?: string): SlashCommand[] {
  const homeDir = os.homedir();
  const commands: SlashCommand[] = [];

  // Global commands: ~/.claude/commands/
  commands.push(...loadCommandsFromDir(path.join(homeDir, '.claude', 'commands')));

  // Global skills: ~/.claude/skills/*/SKILL.md
  commands.push(...loadSkillsFromDir(path.join(homeDir, '.claude', 'skills')));

  // Project commands: .claude/commands/
  if (projectDir) {
    commands.push(...loadCommandsFromDir(path.join(projectDir, '.claude', 'commands')));

    // Project skills: .claude/skills/*/SKILL.md
    commands.push(...loadSkillsFromDir(path.join(projectDir, '.claude', 'skills')));
  }

  // Dedupe by name (project overrides global)
  const seen = new Map<string, SlashCommand>();
  for (const cmd of commands) {
    seen.set(cmd.name, cmd);
  }

  return Array.from(seen.values());
}
