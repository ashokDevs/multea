# Multea Architecture Overview

Multea is a terminal-based multi-agent orchestrator that runs Anthropic's Claude Code agents across multiple repositories with a unified Terminal UI (TUI) and a top-level AI coordinator. This document provides a brief overview of its architecture.

## High-Level Architecture

The system is built as a monolithic Node.js application utilizing React and [Ink](https://github.com/vadimdemedes/ink) for the terminal interface. It acts as a sophisticated wrapper and orchestrator for the `@anthropic-ai/claude-agent-sdk`, allowing users to spawn, manage, and coordinate multiple LLM-driven agents concurrently.

### Core Components

1. **Terminal UI (`src/app.tsx`, `src/components/`)**
   - Built with React and Ink, rendering a rich terminal interface.
   - Manages the visual layout including panes for standard input (command bar), agent outputs, orchestrator chat, tasks, and file browsing.
   - Listens to internal events emitted by the `AgentManager` and `Orchestrator` to update UI state (e.g., streaming agent output, task progress).

2. **AgentManager (`src/core/agent-manager.ts`)**
   - Acts as central registry and controller for all active project agents.
   - Maintains a map of `AgentRunner` instances (one per registered project).
   - Handles the task queue, resolving dependencies between tasks, and dispatching tasks to the appropriate idle agents.
   - Emits unified events (`agentStateChange`, `agentOutput`, `taskComplete`) that drive the UI.

3. **AgentRunner (`src/core/agent-runner.ts`)**
   - The execution engine for a specific project workspace.
   - Wraps the `@anthropic-ai/claude-agent-sdk`'s `query` function.
   - Manages the interaction loop with Claude Code: passing prompts, handling permissions, keeping track of sessions, buffering outputs, and parsing structured LLM responses (text, tool uses, tool results, errors).
   - Supports execution control mechanisms like pause, resume, and abort.

4. **Orchestrator (`src/orchestrator/index.ts`)**
   - The top-level coordinator of the system, capable of understanding higher-level instructions.
   - Translates human instructions / slash commands (e.g., `/dispatch`, `/broadcast`) into structured tasks.
   - Includes a **Scheduler** and **DAG Planner** (`src/orchestrator/scheduler/`) for resolving complex task dependencies and determining execution order.
   - Uses an **EventBus** to facilitate decoupled communication between modules.
   - Stores workspace state and execution plans in a **MemoryStore**.

## Data & Execution Flow

1. **Initialization:** The app reads `multea.config.json` to load registered projects and initializes instances of `AgentManager` and `Orchestrator`.
2. **Scheduling a Task:** 
   - A user types a prompt or a command (like `/dispatch frontend Fix button`) in the command bar.
   - The `App` passes the prompt to `AgentManager` which enqueues a `TaskItem`.
   - If there are dependencies (e.g., `AFTER:1,2`), the task remains `blocked` until prerequisites complete.
3. **Execution:**
   - When an agent is idle and has a `pending` task, `AgentManager` calls `AgentRunner.sendPrompt()`.
   - `AgentRunner` opens an async stream via the Claude Agent SDK setting the specific project's `cwd`.
   - As chunks arrive from the LLM, `AgentRunner` emits `output` events.
   - `AgentManager` forwards these events to the React UI, which updates the agent's specific terminal pane.
4. **Completion:** 
   - Upon success or error, the `AgentRunner` emits a `done` event. 
   - `AgentManager` marks the task complete, unblocks any dependent tasks, and tries dispatching the next task in the queue.

## Tech Stack Overview

- **Runtime:** Node.js
- **UI Framework:** React & Ink (React renderer for terminal)
- **Language:** TypeScript
- **AI Integration:** `@anthropic-ai/claude-agent-sdk` (powers individual agents)
- **State Persistence:** Local JSON state file (`.multea-state.json`) and configuration (`multea.config.json`)
