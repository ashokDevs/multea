/**
 * Demo of the orchestration engine
 * Run with: npx tsx src/orchestrator/examples/demo.ts
 */

import {
  Orchestrator,
  workspace,
  shellTask,
  agentTask,
  type OrchestratorEvent,
  type TaskSpec,
} from '../index.js';

// Simple console logger for events
function logEvent(event: OrchestratorEvent): void {
  const ts = new Date(event.timestamp).toISOString().slice(11, 23);

  switch (event.type) {
    case 'scheduler:start':
      console.log(`\n[${ts}] 🚀 Starting pipeline: ${event.totalTasks} tasks across ${event.workspaces.length} workspaces`);
      break;

    case 'scheduler:complete':
      console.log(`\n[${ts}] ✅ Pipeline complete in ${(event.durationMs / 1000).toFixed(1)}s`);
      console.log(`   Succeeded: ${event.succeeded}, Failed: ${event.failed}, Canceled: ${event.canceled}, Skipped: ${event.skipped}`);
      break;

    case 'task:state':
      const icon = {
        pending: '⏳',
        queued: '📋',
        running: '🔄',
        succeeded: '✅',
        failed: '❌',
        canceled: '🚫',
        skipped: '⏭️',
      }[event.newState];
      console.log(`[${ts}] ${icon} [${event.taskId}] ${event.previousState} → ${event.newState}`);
      break;

    case 'task:retry':
      console.log(`[${ts}] 🔁 [${event.taskId}] Retry ${event.attempt}/${event.maxAttempts} in ${event.delayMs}ms: ${event.reason}`);
      break;

    case 'span:log':
      if (event.level === 'info' || event.level === 'error') {
        console.log(`[${ts}]    ${event.message.slice(0, 80)}`);
      }
      break;
  }
}

async function runDemo(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Orchestrator Demo');
  console.log('='.repeat(60));

  // Create orchestrator
  const orchestrator = new Orchestrator({
    scheduler: {
      globalConcurrency: 3,
      defaultTimeoutMs: 30_000,
    },
  });

  // Subscribe to events
  orchestrator.on(logEvent);

  // Register workspaces (using current directory for demo)
  orchestrator.registerWorkspaces([
    workspace({ id: 'ws1', name: 'Workspace 1', rootPath: process.cwd(), concurrency: 2 }),
    workspace({ id: 'ws2', name: 'Workspace 2', rootPath: process.cwd(), concurrency: 2 }),
  ]);

  // Define tasks with dependencies
  const tasks: TaskSpec[] = [
    // Root tasks (no dependencies) - run in parallel
    shellTask({
      id: 'lint-1', workspaceId: 'ws1', name: 'Lint workspace 1', command: 'echo "Linting ws1..." && sleep 1',
      retry: { maxAttempts: 2, initialDelayMs: 500, maxDelayMs: 2_000, backoffMultiplier: 2 },
    }),
    shellTask({ id: 'lint-2', workspaceId: 'ws2', name: 'Lint workspace 2', command: 'echo "Linting ws2..." && sleep 1' }),

    // Build tasks (depend on lint)
    shellTask({
      id: 'build-1', workspaceId: 'ws1', name: 'Build workspace 1', command: 'echo "Building ws1..." && sleep 2',
      deps: ['lint-1'],
    }),
    shellTask({
      id: 'build-2', workspaceId: 'ws2', name: 'Build workspace 2', command: 'echo "Building ws2..." && sleep 2',
      deps: ['lint-2'],
    }),

    // Test tasks (depend on build)
    shellTask({
      id: 'test-1', workspaceId: 'ws1', name: 'Test workspace 1', command: 'echo "Testing ws1..." && sleep 1',
      deps: ['build-1'],
    }),
    shellTask({
      id: 'test-2', workspaceId: 'ws2', name: 'Test workspace 2', command: 'echo "Testing ws2..." && sleep 1',
      deps: ['build-2'],
    }),

    // Integration test (depends on both tests)
    shellTask({
      id: 'integration', workspaceId: 'ws1', name: 'Integration tests', command: 'echo "Running integration tests..." && sleep 2',
      deps: ['test-1', 'test-2'],
    }),

    // Deploy (depends on integration)
    shellTask({
      id: 'deploy', workspaceId: 'ws1', name: 'Deploy', command: 'echo "Deploying..." && sleep 1',
      deps: ['integration'],
    }),
  ];

  console.log('\nTask dependency graph:');
  console.log('  lint-1 ──┬──▶ build-1 ──▶ test-1 ──┐');
  console.log('           │                        ├──▶ integration ──▶ deploy');
  console.log('  lint-2 ──┴──▶ build-2 ──▶ test-2 ──┘');
  console.log('');

  try {
    const result = await orchestrator.execute(tasks);

    console.log('\n' + '='.repeat(60));
    console.log('Result Summary');
    console.log('='.repeat(60));
    console.log(`Plan ID: ${result.planId}`);
    console.log(`Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
    console.log(`Succeeded: ${result.succeeded.join(', ') || 'none'}`);
    console.log(`Failed: ${result.failed.join(', ') || 'none'}`);
    console.log(`Canceled: ${result.canceled.join(', ') || 'none'}`);
    console.log(`Skipped: ${result.skipped.join(', ') || 'none'}`);
  } catch (error) {
    console.error('Pipeline failed:', error);
  } finally {
    await orchestrator.dispose();
  }
}

// Demo with failure and cancellation propagation
async function runFailureDemo(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('Failure Propagation Demo');
  console.log('='.repeat(60));

  const orchestrator = new Orchestrator({
    scheduler: {
      globalConcurrency: 2,
      cancelOnFailure: true,
    },
  });

  orchestrator.on(logEvent);
  orchestrator.registerWorkspace(workspace({ id: 'main', name: 'Main', rootPath: process.cwd(), concurrency: 2 }));

  const tasks: TaskSpec[] = [
    shellTask({ id: 'step-1', workspaceId: 'main', name: 'Step 1', command: 'echo "Step 1" && sleep 1' }),
    shellTask({
      id: 'step-2', workspaceId: 'main', name: 'Step 2 (will fail)', command: 'echo "Step 2 failing..." && exit 1',
      deps: ['step-1'],
      retry: { maxAttempts: 2, initialDelayMs: 500, maxDelayMs: 1_000, backoffMultiplier: 2 },
    }),
    shellTask({
      id: 'step-3', workspaceId: 'main', name: 'Step 3 (will be canceled)', command: 'echo "Step 3"',
      deps: ['step-2'],
    }),
    shellTask({
      id: 'step-4', workspaceId: 'main', name: 'Step 4 (will be canceled)', command: 'echo "Step 4"',
      deps: ['step-3'],
    }),
  ];

  console.log('\nExpected: step-2 fails after retries, step-3 and step-4 are canceled\n');

  try {
    const result = await orchestrator.execute(tasks);
    console.log(`\nResult: ${result.succeeded.length} succeeded, ${result.failed.length} failed, ${result.canceled.length} canceled`);
  } finally {
    await orchestrator.dispose();
  }
}

// Run demos
async function main(): Promise<void> {
  await runDemo();
  await runFailureDemo();
}

main().catch(console.error);
