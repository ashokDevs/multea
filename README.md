<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=000" alt="React" />
  <img src="https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=fff" alt="Node.js" />
  <img src="https://img.shields.io/badge/Claude_AI-CC785C?logo=anthropic&logoColor=fff" alt="Claude AI" />
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT License" />
  <img src="https://img.shields.io/badge/PRs-Welcome-brightgreen.svg" alt="PRs Welcome" />
</p>

<h1 align="center">Multea</h1>

<p align="center">
  <strong>Terminal-based multi-agent orchestrator for Claude Code</strong><br/>
  Run multiple AI coding agents across repositories simultaneously with a unified TUI and AI-powered task coordination.
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#usage">Usage</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#keyboard-shortcuts">Shortcuts</a> &bull;
  <a href="#contributing">Contributing</a>
</p>

---

## Why Multea?

Modern software teams work across multiple repositories simultaneously. AI coding assistants are powerful, but managing separate agent sessions for each repo is chaotic. **Multea** solves this by providing a single terminal interface that orchestrates multiple Claude Code agents working in parallel — with dependency-aware task scheduling, real-time streaming output, and an AI coordinator that breaks complex instructions into subtasks.

Think of it as **tmux for AI agents** — but with built-in task orchestration, dependency graphs, and an AI brain coordinating everything.

## Features

### Multi-Agent Orchestration
- **Concurrent agents** — Spawn independent Claude Code agents per project, all running in parallel
- **Task queue with dependency resolution** — DAG-based scheduling ensures tasks execute in the correct order
- **Priority levels** — Critical, high, normal, and low priority task support
- **Auto-dispatch** — Idle agents automatically pick up the next eligible task
- **Pause / Resume / Abort** — Full lifecycle control over individual agents

### AI-Powered Coordination
- **Top-level orchestrator** — An AI coordinator that understands high-level instructions and decomposes them into subtasks
- **Slash commands** — `/dispatch`, `/broadcast`, `/status` and more for direct agent control
- **DAG planner** — Topological sort with cycle detection for complex multi-step workflows
- **Cross-repo awareness** — Coordinate changes that span multiple codebases

### Rich Terminal UI (TUI)
- **Multi-pane layout** — Agent output, orchestrator chat, task queue, and questions — all visible at once
- **Real-time streaming** — Watch agent output as it arrives, not after it completes
- **Keyboard-driven navigation** — Vim-inspired shortcuts for fast context switching
- **Directory browser** — Browse project files without leaving the TUI
- **Markdown rendering** — Rich text in the orchestrator pane

### Developer Experience
- **Session persistence** — Resume where you left off across restarts
- **Dual authentication** — API key or Claude Code native auth
- **Config-driven setup** — Single JSON file to register all your projects
- **File logging** — All agent outputs logged to `./logs/` for post-session review

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **Claude Code** CLI installed ([get it here](https://docs.anthropic.com/en/docs/claude-code/overview))
- An **Anthropic API key** or active Claude Code authentication

### Installation

```bash
# Clone the repository
git clone https://github.com/ashokDevs/multea.git
cd multea

# Install dependencies
npm install
```

### Run

```bash
# Development mode
npm run dev

# Or with a custom config path
npx tsx src/index.tsx path/to/config.json

# Production build
npm run build && node dist/index.js
```

On first launch, Multea will prompt you to choose an authentication method (API key or Claude Code auth). Your choice is saved for future sessions.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Terminal UI (React + Ink)                    │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────┐ ┌───────────┐  │
│  │ Agent Panes  │ │ Orchestrator │ │  Tasks   │ │ Questions │  │
│  │ (per project)│ │   Chat Pane  │ │  Queue   │ │   Pane    │  │
│  └──────┬───────┘ └──────┬───────┘ └────┬─────┘ └─────┬─────┘  │
│         │                │              │              │         │
├─────────┴────────────────┴──────────────┴──────────────┴────────┤
│                                                                  │
│  ┌──────────────────────┐    ┌──────────────────────────────┐   │
│  │    AgentManager      │◄──►│       Orchestrator           │   │
│  │  ┌────────────────┐  │    │  - AI coordinator            │   │
│  │  │  AgentRunner A │  │    │  - Slash command parser      │   │
│  │  │  AgentRunner B │  │    │  - DAG planner               │   │
│  │  │  AgentRunner C │  │    │  - Conversation history      │   │
│  │  └────────────────┘  │    └──────────────────────────────┘   │
│  │  ┌────────────────┐  │                                       │
│  │  │   TaskQueue    │  │    ┌──────────────────────────────┐   │
│  │  │ (DAG-based)    │  │    │     Persistence Layer        │   │
│  │  └────────────────┘  │    │  .multea-state.json          │   │
│  └──────────────────────┘    └──────────────────────────────┘   │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│              @anthropic-ai/claude-agent-sdk                      │
└──────────────────────────────────────────────────────────────────┘
```

### Core Components

| Component | Responsibility |
|-----------|---------------|
| **AgentManager** | Central registry for all agents. Handles task queuing, dependency resolution, and event emission. |
| **AgentRunner** | Execution engine per project. Wraps the Claude Agent SDK, manages sessions, buffers output. |
| **TaskQueue** | DAG-based dependency resolution with priority ordering and blocked-state tracking. |
| **Orchestrator** | Top-level AI coordinator. Translates high-level instructions into structured task dispatches. |
| **Persistence** | Saves orchestrator state, task queue, and session data to disk for resume capability. |

### Data Flow

```
User Input → App → AgentManager / Orchestrator → TaskQueue → AgentRunner → Claude Agent SDK
                                                                    ↓
Terminal UI ← React State Updates ← Event Emitters ← Agent Output Stream
```

## Usage

### Slash Commands

| Command | Description |
|---------|-------------|
| `/dispatch <project> <prompt>` | Send a task to a specific project agent |
| `/broadcast <prompt>` | Send the same task to all agents |
| `/status` | View the status of all agents and queued tasks |
| `/help` | Show all available commands |
| `/clear` | Clear the orchestrator chat history |
| `/context` | View current context and session info |

### Task Dependencies

Tasks can declare dependencies using the `AFTER:` prefix:

```
/dispatch backend "Create user API endpoint"
/dispatch frontend "Build user form component AFTER:1"
/dispatch e2e-tests "Write integration tests AFTER:1,2"
```

Task 2 waits for task 1 to complete. Task 3 waits for both tasks 1 and 2.

## Configuration

Create a `multea.config.json` in your project root:

```json
{
  "projects": [
    {
      "name": "backend",
      "path": "/absolute/path/to/backend-repo"
    },
    {
      "name": "frontend",
      "path": "/absolute/path/to/frontend-repo"
    },
    {
      "name": "shared-lib",
      "path": "/absolute/path/to/shared-library"
    }
  ],
  "initialTasks": [
    {
      "projectName": "backend",
      "prompt": "Review the current API endpoints and suggest improvements"
    }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `projects[].name` | Yes | Unique identifier for the project agent |
| `projects[].path` | Yes | Absolute path to the project directory |
| `initialTasks` | No | Tasks to auto-dispatch on startup |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `q` | Quit Multea |
| `1` / `2` / `3` | Switch between panes (agents / orchestrator / questions) |
| `h` / `l` | Navigate panes left / right |
| `Tab` / `Shift+Tab` | Cycle through agent panes |
| `i` / `Enter` | Enter input mode (type commands) |
| `Esc` | Exit input mode |
| `o` | Trigger orchestrator evaluation |
| `x` | Stop the focused agent |
| `?` | Show help popup |

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js |
| **Language** | TypeScript 5.9+ (strict mode) |
| **UI Framework** | React 19 + [Ink](https://github.com/vadimdemedes/ink) (React for terminals) |
| **AI Integration** | [@anthropic-ai/claude-agent-sdk](https://docs.anthropic.com/en/docs/claude-code/sdk) |
| **Build** | tsup (ESM output) |
| **Dev Server** | tsx |
| **Linting** | ESLint 9 + TypeScript ESLint |
| **Formatting** | Prettier |

## Project Structure

```
src/
├── index.tsx                  # Entry point — auth selection & app bootstrap
├── app.tsx                    # Main React app component
├── config.ts                  # Config loading & validation
├── types.ts                   # Shared TypeScript type definitions
│
├── core/
│   ├── agent-manager.ts       # Multi-agent registry & task dispatcher
│   ├── agent-runner.ts        # Single agent execution engine
│   ├── orchestrator.ts        # High-level AI task coordinator
│   ├── task-queue.ts          # DAG-based dependency-aware task queue
│   ├── persistence.ts         # State serialization & resume
│   └── sdk-env.ts             # Authentication & environment setup
│
├── components/                # React + Ink terminal UI components
│   ├── agent-pane.tsx         # Individual agent output display
│   ├── orchestrator-pane.tsx  # Orchestrator chat interface
│   ├── task-pane.tsx          # Task queue visualization
│   ├── command-bar.tsx        # User input bar
│   ├── questions-pane.tsx     # Agent-posed questions
│   ├── sidebar-pane.tsx       # Navigation sidebar
│   ├── status-bar.tsx         # System status display
│   ├── help-popup.tsx         # Keyboard shortcut reference
│   ├── directory-browser.tsx  # In-TUI file browser
│   └── sessions-pane.tsx      # Session management
│
├── orchestrator/              # Advanced orchestration subsystem
│   ├── index.ts               # Orchestrator entry point
│   ├── core/                  # Core orchestration logic
│   ├── scheduler/             # DAG planner & topological sort
│   ├── connectors/            # Extensible task executors
│   └── questions/             # Agent question routing
│
└── utils/                     # Shared utilities
```

## Use Cases

- **Monorepo development** — Coordinate changes across frontend, backend, and shared libraries simultaneously
- **Microservices** — Update multiple services in parallel with dependency-aware ordering
- **Migration projects** — Run migration scripts across dozens of repos with a single command
- **Code review assistance** — Have agents review different parts of a large changeset concurrently
- **Refactoring at scale** — Rename, restructure, or update patterns across your entire stack

## Roadmap

- [ ] Custom themes for the TUI
- [ ] Plugin system for user-defined commands
- [ ] Vim mode for power-user navigation
- [ ] Web dashboard companion
- [ ] Agent-to-agent communication
- [ ] Metrics and cost tracking dashboard

## Contributing

Contributions are welcome! Whether it's bug reports, feature requests, or pull requests — all contributions help make Multea better.

```bash
# Fork & clone
git clone https://github.com/<your-username>/multea.git

# Install dependencies
npm install

# Start development
npm run dev

# Lint & format
npm run lint
npm run format
```

## License

MIT &copy; [ashokDevs](https://github.com/ashokDevs)

---

<p align="center">
  Built with <a href="https://docs.anthropic.com/en/docs/claude-code/overview">Claude Code</a> and the <a href="https://docs.anthropic.com/en/docs/claude-code/sdk">Claude Agent SDK</a>
</p>
