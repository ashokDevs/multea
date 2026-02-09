/**
 * Smoke test: sends one prompt to claude via expect PTY wrapper.
 * Usage: npm run smoke
 */
import 'dotenv/config';
import { AgentRunner } from './core/agent-runner.js';

const runner = new AgentRunner('smoke-test', process.cwd());

runner.on('stateChange', (state) => {
  console.log(`[state] ${state}`);
});

runner.on('output', (output) => {
  console.log(`[${output.type}] ${output.content}`);
});

runner.on('done', ({ success }) => {
  console.log(`\nDone. Success: ${success}`);
  process.exit(success ? 0 : 1);
});

// Safety timeout
setTimeout(() => {
  console.log('\nTimeout — killing agent.');
  runner.abort();
  process.exit(1);
}, 120_000);

console.log('Starting smoke test...');
runner.sendPrompt('Say hello from multea and nothing else');
