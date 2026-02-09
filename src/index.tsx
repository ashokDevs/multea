#!/usr/bin/env node
import 'dotenv/config';
import * as readline from 'node:readline';
import { render } from 'ink';
import { App } from './app.js';
import { loadConfig } from './config.js';
import { getSavedAuthMethod, saveAuthMethod, type AuthMethod } from './core/persistence.js';
import type { MulteaConfig } from './types.js';

const STATE_FILE = '.multea-state.json';

const configPath = process.argv[2];

let config: MulteaConfig;
try {
  config = loadConfig(configPath);
} catch (err) {
  console.error(`Error: ${(err as Error).message}`);
  console.error('Usage: npx tsx src/index.tsx [path/to/multea.config.json]');
  process.exit(1);
}

/**
 * Get authentication method - uses saved preference or prompts user
 */
async function getAuthMethod(): Promise<AuthMethod> {
  // Check for previously saved auth method
  const savedAuth = getSavedAuthMethod(STATE_FILE);
  if (savedAuth) {
    console.log(`→ Using saved auth method: ${savedAuth === 'api' ? 'API key' : 'Claude Code auth'}\n`);
    return savedAuth;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    const authMethod: AuthMethod = 'auth';
    saveAuthMethod(STATE_FILE, authMethod);
    return authMethod;
  }

  // Prompt user for auth method
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log('\n┌─────────────────────────────────────────┐');
    console.log('│           MULTEA - Authentication       │');
    console.log('├─────────────────────────────────────────┤');
    console.log('│  API key detected in environment.       │');
    console.log('│                                         │');
    console.log('│  [1] Use API key (direct API access)    │');
    console.log('│  [2] Use Claude Code auth (recommended) │');
    console.log('└─────────────────────────────────────────┘');

    rl.question('\nSelect authentication method [1/2]: ', (answer) => {
      rl.close();
      const choice = answer.trim();
      const authMethod: AuthMethod = choice === '1' ? 'api' : 'auth';

      // Save the choice for future sessions
      saveAuthMethod(STATE_FILE, authMethod);

      if (authMethod === 'api') {
        console.log('→ Using API key (saved for future sessions)\n');
      } else {
        console.log('→ Using Claude Code authentication (saved for future sessions)\n');
      }
      resolve(authMethod);
    });
  });
}

async function main() {
  const authMethod = await getAuthMethod();

  process.stdout.write('\x1b[?1049h');
  process.stdout.write('\x1b[H');

  const { waitUntilExit } = render(<App config={config} authMethod={authMethod} />, {
    exitOnCtrlC: true,
  });

  await waitUntilExit();

  process.stdout.write('\x1b[?1049l');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
