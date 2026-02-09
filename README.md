# Multea

Terminal-based multi-agent orchestrator that runs Claude Code agents across multiple repos with a unified TUI and a top-level AI coordinator.

## Setup

```bash
npm install
```

## Usage

1. Edit `multea.config.json` with your project paths
2. Run the TUI:

```bash
npm run dev
```

Or specify a config file:

```bash
npx tsx src/index.tsx path/to/config.json
```

### Smoke Test

```bash
npm run smoke
```

## Keyboard Shortcuts

| Key       | Action                          |
|-----------|---------------------------------|
| Tab       | Switch focus to next agent      |
| Shift+Tab | Switch focus to previous agent  |
| i / Enter | Enter input mode (send prompt)  |
| o         | Trigger orchestrator evaluation |
| x         | Stop focused agent              |
| q         | Quit                            |

## Config Format

```json
{
  "projects": [
    { "name": "my-app", "path": "/path/to/my-app" },
    { "name": "my-lib", "path": "/path/to/my-lib" }
  ],
  "initialTasks": [
    { "projectName": "my-app", "prompt": "Fix the failing tests" }
  ]
}
```

## License

MIT
