import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MulteaConfig } from './types.js';

const DEFAULT_CONFIG_NAME = 'multea.config.json';

let _configPath: string | null = null;

export function getConfigPath(): string {
  return _configPath ?? resolve(process.cwd(), DEFAULT_CONFIG_NAME);
}

export function loadConfig(configPath?: string): MulteaConfig {
  const filePath = configPath ?? resolve(process.cwd(), DEFAULT_CONFIG_NAME);
  _configPath = filePath;

  if (!existsSync(filePath)) {
    throw new Error(`Config not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, 'utf-8');
  const config: MulteaConfig = JSON.parse(raw);

  if (!config.projects || !Array.isArray(config.projects) || config.projects.length === 0) {
    throw new Error('Config must have at least one project in "projects" array');
  }

  for (const p of config.projects) {
    if (!p.name || !p.path) {
      throw new Error(`Each project must have "name" and "path" fields`);
    }
  }

  return config;
}

export function saveConfig(config: MulteaConfig, configPath?: string): void {
  const filePath = configPath ?? _configPath ?? resolve(process.cwd(), DEFAULT_CONFIG_NAME);

  try {
    writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
  } catch (error) {
    throw new Error(`Failed to save config: ${error}`);
  }
}
