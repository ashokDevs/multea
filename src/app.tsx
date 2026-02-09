import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, useApp, useStdout } from 'ink';
import { AgentManager } from './core/agent-manager.js';
import { Orchestrator } from './core/orchestrator.js';
import { saveState, loadState, saveAuthMethod, type AuthMethod } from './core/persistence.js';
import { saveConfig } from './config.js';
import { OrchestratorPane } from './components/orchestrator-pane.js';
import { SidebarPane } from './components/sidebar-pane.js';
import { QuestionsPane, type Question } from './components/questions-pane.js';
import { CommandBar } from './components/command-bar.js';
import { HelpPopup } from './components/help-popup.js';
import { DirectoryBrowser } from './components/directory-browser.js';
import type { PanelId } from './components/command-bar.js';
import type { AgentState, AgentOutput, MulteaConfig, OrchestratorMessage, TaskItem, ProjectConfig } from './types.js';

const STATE_PATH = '.multea-state.json';

interface AppProps {
  config: MulteaConfig;
  authMethod: 'api' | 'auth';
}

export function App({ config, authMethod }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [termHeight, setTermHeight] = useState(stdout?.rows ?? 24);
  const [manager] = useState(() => new AgentManager(config.projects, authMethod));
  const [orchestrator] = useState(() => new Orchestrator(manager, authMethod));

  useEffect(() => {
    const onResize = () => setTermHeight(stdout?.rows ?? 24);
    stdout?.on('resize', onResize);
    return () => { stdout?.off('resize', onResize); };
  }, [stdout]);
  const [activePanel, setActivePanel] = useState<PanelId>('orch');
  const [selectedAgentIndex, setSelectedAgentIndex] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [states, setStates] = useState<Map<string, AgentState>>(() => manager.getStates());
  const [outputs, setOutputs] = useState<Map<string, AgentOutput[]>>(() => {
    const m = new Map<string, AgentOutput[]>();
    for (const name of manager.getAgentNames()) m.set(name, []);
    return m;
  });
  const [orchMessages, setOrchMessages] = useState<OrchestratorMessage[]>([]);
  const [orchRunning, setOrchRunning] = useState(false);
  const [orchScrollOffset, setOrchScrollOffset] = useState(0);
  const [tasks, setTasks] = useState<readonly TaskItem[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  const [showBrowser, setShowBrowser] = useState(false);
  const [projects, setProjects] = useState<ProjectConfig[]>(() => manager.getProjects());

  // Derive agent names from projects state for reactivity
  const agentNames = projects.map((p) => p.name);

  const updateTasks = useCallback(() => {
    setTasks([...manager.taskQueue.getAll()]);
  }, [manager]);

  const persistState = useCallback(() => {
    const agentSessions: Record<string, boolean> = {};
    for (const name of manager.getAgentNames()) {
      const agent = manager.getAgent(name);
      if (agent) agentSessions[name] = agent.hasSession;
    }
    saveState(STATE_PATH, {
      orchMessages,
      tasks: [...manager.taskQueue.getAll()],
      agentSessions,
    });
  }, [manager, orchMessages]);

  useEffect(() => {
    const persisted = loadState(STATE_PATH);
    if (persisted) {
      if (persisted.agentSessions) {
        for (const [name, hasSession] of Object.entries(persisted.agentSessions)) {
          const agent = manager.getAgent(name);
          if (agent && hasSession) agent.hasSessionFlag = hasSession;
        }
      }
    }

    // Batch rapid state/output updates to reduce flickering
    const pendingStates = new Map<string, AgentState>();
    const pendingOutputs = new Map<string, AgentOutput[]>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const FLUSH_INTERVAL = 150; // ms

    function flushUpdates() {
      flushTimer = null;
      if (pendingStates.size > 0) {
        const batch = new Map(pendingStates);
        pendingStates.clear();
        setStates((prev) => {
          const next = new Map(prev);
          for (const [n, s] of batch) next.set(n, s);
          return next;
        });
      }
      if (pendingOutputs.size > 0) {
        const batch = new Map(pendingOutputs);
        pendingOutputs.clear();
        setOutputs((prev) => {
          const next = new Map(prev);
          for (const [n, newItems] of batch) {
            const arr = [...(next.get(n) ?? []), ...newItems];
            next.set(n, arr.length > 200 ? arr.slice(-150) : arr);
          }
          return next;
        });
      }
    }

    function scheduleFlush() {
      if (!flushTimer) {
        flushTimer = setTimeout(flushUpdates, FLUSH_INTERVAL);
      }
    }

    manager.on('agentStateChange', ({ name, state }) => {
      pendingStates.set(name, state);
      scheduleFlush();
    });

    manager.on('agentOutput', ({ name, output }) => {
      const existing = pendingOutputs.get(name) ?? [];
      existing.push(output);
      pendingOutputs.set(name, existing);
      scheduleFlush();
    });

    manager.on('agentQuestion', ({ name, question }) => {
      const sysMsg: OrchestratorMessage = {
        role: 'system',
        content: `[${name}] asks: ${question}`,
        timestamp: Date.now(),
      };
      setOrchMessages((prev) => [...prev, sysMsg]);
    });

    manager.on('taskComplete', ({ name, taskId, success, output, prompt }) => {
      updateTasks();

      // Show task completion with output in orchestrator
      const status = success ? '✓' : '✗';
      const truncatedPrompt = prompt.length > 50 ? prompt.slice(0, 50) + '...' : prompt;
      const truncatedOutput = output.length > 1000 ? output.slice(0, 1000) + '\n...(truncated)' : output;

      const sysMsg: OrchestratorMessage = {
        role: 'assistant',
        content: `${status} Task #${taskId} completed [${name}]\n` +
          `Task: ${truncatedPrompt}\n\n` +
          `Output:\n${truncatedOutput || '(no output)'}`,
        timestamp: Date.now(),
      };
      setOrchMessages((prev) => [...prev, sysMsg]);
    });

    orchestrator.on('message', (msg) => {
      setOrchMessages((prev) => [...prev, msg]);
      if (msg.role === 'assistant') {
        setOrchRunning(false);
      }
    });

    orchestrator.on('dispatch', (commands) => {
      for (const cmd of commands) {
        manager.dispatchTask(cmd.agentName, cmd.prompt, {
          dependsOn: cmd.dependsOn,
          priority: cmd.priority,
        });
      }
      updateTasks();
    });

    // Handle orchestrator errors gracefully
    orchestrator.on('error', (errorMsg) => {
      setOrchRunning(false);
      const sysMsg: OrchestratorMessage = {
        role: 'system',
        content: `⚠️ ${errorMsg}`,
        timestamp: Date.now(),
      };
      setOrchMessages((prev) => [...prev, sysMsg]);
    });

    // Listen for tasks becoming unblocked (just update task list, no message)
    manager.on('taskUnblocked', () => {
      updateTasks();
    });

    manager.startAll();

    if (config.initialTasks) {
      for (const task of config.initialTasks) {
        manager.dispatchTask(task.projectName, task.prompt);
      }
      updateTasks();
    }

    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      manager.stopAll();
    };
  }, []);

  const handleSendPrompt = useCallback(
    (agentName: string, prompt: string) => {
      manager.dispatchTask(agentName, prompt);
      updateTasks();
    },
    [manager, updateTasks],
  );

  const handleQuit = useCallback(() => {
    persistState();
    manager.stopAll();
    exit();
  }, [manager, exit, persistState]);

  const handleAddWorkspace = useCallback(() => {
    setShowBrowser(true);
  }, []);

  const handleSelectWorkspace = useCallback((path: string) => {
    setShowBrowser(false);

    // Generate a name from the path (last directory name)
    const name = path.split('/').pop() || 'unnamed';

    // Check if name already exists, add suffix if needed
    let finalName = name;
    let counter = 1;
    while (manager.getAgentNames().includes(finalName)) {
      finalName = `${name}-${counter}`;
      counter++;
    }

    const project: ProjectConfig = { name: finalName, path };

    if (manager.addProject(project)) {
      // Update local state
      setProjects(manager.getProjects());
      setStates(manager.getStates());
      setOutputs((prev) => {
        const next = new Map(prev);
        next.set(finalName, []);
        return next;
      });

      // Persist to config file
      const updatedConfig: MulteaConfig = {
        ...config,
        projects: manager.getProjects(),
      };
      try {
        saveConfig(updatedConfig);
      } catch {
        // config save is best-effort, don't block UI
      }
    }
  }, [manager, config]);

  const handleCancelBrowser = useCallback(() => {
    setShowBrowser(false);
  }, []);

  const handleRemoveWorkspace = useCallback((name: string) => {
    if (manager.removeProject(name)) {
      setProjects(manager.getProjects());
      setStates(manager.getStates());
      setOutputs((prev) => {
        const next = new Map(prev);
        next.delete(name);
        return next;
      });

      const newNames = manager.getAgentNames();
      if (selectedAgentIndex >= newNames.length) {
        setSelectedAgentIndex(Math.max(0, newNames.length - 1));
      }

      const updatedConfig: MulteaConfig = {
        ...config,
        projects: manager.getProjects(),
      };
      try {
        saveConfig(updatedConfig);
      } catch {
        // config save is best-effort, don't block UI
      }
    }
  }, [manager, config, selectedAgentIndex]);

  const [orchEditing, setOrchEditing] = useState(false);

  const handleSendOrchestratorMessage = useCallback(
    (msg: string) => {
      setOrchRunning(true);
      orchestrator.sendMessage(msg);
    },
    [orchestrator],
  );

  const handleSlashCommand = useCallback(
    (command: string, args: string) => {
      const sysMsg = (content: string): OrchestratorMessage => ({
        role: 'system',
        content,
        timestamp: Date.now(),
      });

      switch (command) {
        // ══════════════════════════════════════════════════════════════════════
        // Claude Code Commands
        // ══════════════════════════════════════════════════════════════════════
        case '/help': {
          const helpText = `
╔══════════════════════════════════════════════════════════════════════╗
║                         MULTEA COMMANDS                              ║
╠══════════════════════════════════════════════════════════════════════╣
║  CLAUDE CODE COMMANDS                                                ║
║  /help             Show this help message                            ║
║  /clear            Clear conversation history                        ║
║  /compact          Summarize and compact conversation                ║
║  /context          Show current context usage stats                  ║
║  /cost             Show token usage and session stats                ║
║  /model            Display AI model info                             ║
║  /config           Show current configuration                        ║
║  /export [file]    Export conversation to file                       ║
╠══════════════════════════════════════════════════════════════════════╣
║  MULTITASKING COMMANDS                                               ║
║  /dispatch <agent> [AFTER:ids] [PRIORITY:lvl] <prompt>               ║
║                    Dispatch task with optional dependencies          ║
║  /broadcast <prompt>         Send prompt to ALL agents               ║
║  /status                     Show all agent states                   ║
║  /agents                     List all configured agents              ║
║  /queue                      Show task queue with dependencies       ║
║  /task <id>                  Show task details                       ║
║  /cancel <id>                Cancel task and dependent tasks         ║
║  /stop <agent|all>           Stop agent(s)                           ║
║  /pause <agent|all>          Pause agent(s)                          ║
║  /resume <agent|all>         Resume agent(s)                         ║
╠══════════════════════════════════════════════════════════════════════╣
║  TASK DEPENDENCIES                                                   ║
║  Use AFTER:id1,id2 to run task after others complete                 ║
║  Use PRIORITY:critical|high|normal|low to set priority               ║
║  Example: /dispatch backend AFTER:1,2 PRIORITY:high Deploy           ║
╠══════════════════════════════════════════════════════════════════════╣
║  SESSION COMMANDS                                                    ║
║  /save             Save current session state                        ║
║  /load             Load saved session state                          ║
║  /reset            Reset all agents and clear state                  ║
╚══════════════════════════════════════════════════════════════════════╝`;
          setOrchMessages((prev) => [...prev, sysMsg(helpText)]);
          break;
        }

        case '/clear':
          setOrchMessages([]);
          break;

        case '/compact': {
          const keep = 10;
          setOrchMessages((prev) => {
            if (prev.length <= keep) return prev;
            const summary: OrchestratorMessage = {
              role: 'system',
              content: `[Compacted ${prev.length - keep} older messages]`,
              timestamp: Date.now(),
            };
            return [summary, ...prev.slice(-keep)];
          });
          break;
        }

        case '/context': {
          const totalMsgs = orchMessages.length;
          const userMsgs = orchMessages.filter((m) => m.role === 'user').length;
          const assistantMsgs = orchMessages.filter((m) => m.role === 'assistant').length;
          const systemMsgs = orchMessages.filter((m) => m.role === 'system').length;
          const runningAgents = agentNames.filter((n) => states.get(n) === 'running').length;
          const queuedTasks = tasks.filter((t) => t.status === 'pending').length;
          setOrchMessages((prev) => [
            ...prev,
            sysMsg(
              `Context Usage:\n` +
              `  Messages: ${totalMsgs} total (${userMsgs} user, ${assistantMsgs} assistant, ${systemMsgs} system)\n` +
              `  Agents: ${agentNames.length} configured, ${runningAgents} running\n` +
              `  Queue: ${queuedTasks} pending tasks`,
            ),
          ]);
          break;
        }

        case '/cost': {
          const runningAgents = agentNames.filter((n) => states.get(n) === 'running').length;
          const completedTasks = tasks.filter((t) => t.status === 'done').length;
          setOrchMessages((prev) => [
            ...prev,
            sysMsg(
              `Session Stats:\n` +
              `  Messages: ${orchMessages.length}\n` +
              `  Agents: ${agentNames.length} (${runningAgents} active)\n` +
              `  Tasks completed: ${completedTasks}\n` +
              `  Tasks in queue: ${tasks.filter((t) => t.status === 'pending').length}`,
            ),
          ]);
          break;
        }

        case '/model':
          setOrchMessages((prev) => [
            ...prev,
            sysMsg(
              `Model: Claude (via orchestrator)\n` +
              `  Each agent spawns its own Claude Code instance\n` +
              `  Orchestrator coordinates via Claude API`,
            ),
          ]);
          break;

        case '/config': {
          const projectList = config.projects
            .map((p) => `  • ${p.name}: ${p.path}`)
            .join('\n');
          setOrchMessages((prev) => [
            ...prev,
            sysMsg(
              `Configuration:\n` +
              `  Projects:\n${projectList}\n` +
              `  State file: ${STATE_PATH}`,
            ),
          ]);
          break;
        }

        case '/auth': {
          const validArgs = ['api', 'auth', 'reset'];
          if (args && validArgs.includes(args)) {
            if (args === 'reset') {
              saveAuthMethod(STATE_PATH, 'auth');
              setOrchMessages((prev) => [
                ...prev,
                sysMsg('Auth method reset to Claude Code auth. Restart to apply.'),
              ]);
            } else {
              const newAuth = args as AuthMethod;
              saveAuthMethod(STATE_PATH, newAuth);
              setOrchMessages((prev) => [
                ...prev,
                sysMsg(`Auth method changed to "${newAuth}". Restart to apply.`),
              ]);
            }
          } else {
            setOrchMessages((prev) => [
              ...prev,
              sysMsg(
                `Authentication:\n` +
                `  Current: ${authMethod === 'api' ? 'API key' : 'Claude Code auth'}\n\n` +
                `  Usage: /auth <api|auth|reset>\n` +
                `    api   - Use ANTHROPIC_API_KEY from environment\n` +
                `    auth  - Use Claude Code's built-in auth\n` +
                `    reset - Reset to default (Claude Code auth)`,
              ),
            ]);
          }
          break;
        }

        case '/memory': {
          const memoryPaths = [
            '~/.claude/CLAUDE.md (global)',
            './.claude/CLAUDE.md (project)',
            './CLAUDE.md (project root)',
          ];
          setOrchMessages((prev) => [
            ...prev,
            sysMsg(
              `Memory Files (CLAUDE.md locations):\n` +
              `  Claude Code reads these files for context:\n` +
              memoryPaths.map((p) => `  • ${p}`).join('\n') +
              `\n\n  Each agent project can have its own CLAUDE.md`,
            ),
          ]);
          break;
        }

        case '/permissions':
          setOrchMessages((prev) => [
            ...prev,
            sysMsg(
              `Permissions:\n` +
              `  Orchestrator: Full control over all agents\n` +
              `  Agents: Inherit Claude Code permissions per project\n` +
              `  Tools: Read, Write, Edit, Bash, etc. (per agent config)`,
            ),
          ]);
          break;

        case '/export': {
          const filename = args || `multea-export-${Date.now()}.json`;
          const exportData = {
            timestamp: Date.now(),
            messages: orchMessages,
            agents: agentNames.map((name) => ({
              name,
              state: states.get(name),
            })),
            tasks: [...tasks],
          };
          // For now, just show the export - full file write would need fs access
          setOrchMessages((prev) => [
            ...prev,
            sysMsg(
              `Export prepared (${orchMessages.length} messages, ${tasks.length} tasks)\n` +
              `  Filename: ${filename}\n` +
              `  Note: File export requires fs access - data logged to console`,
            ),
          ]);
          process.stdout.write(JSON.stringify(exportData, null, 2) + '\n');
          break;
        }

        case '/theme':
          setOrchMessages((prev) => [...prev, sysMsg('Theme switching not yet implemented')]);
          break;

        case '/vim':
          setOrchMessages((prev) => [...prev, sysMsg('Vim mode not yet implemented')]);
          break;

        // ══════════════════════════════════════════════════════════════════════
        // Multitasking Commands
        // ══════════════════════════════════════════════════════════════════════
        case '/dispatch': {
          // Parse: /dispatch agent [AFTER:1,2] [PRIORITY:high] prompt
          // Or simple: /dispatch agent prompt
          const parts = args.match(/^(\S+)(?:\s+AFTER:(\S+))?(?:\s+PRIORITY:(critical|high|normal|low))?(?:\s+(.+))?$/i);

          if (!parts || !parts[4]) {
            setOrchMessages((prev) => [...prev, sysMsg(
              'Usage: /dispatch <agent> [AFTER:task-ids] [PRIORITY:level] <prompt>\n' +
              '  Examples:\n' +
              '    /dispatch frontend Fix the button\n' +
              '    /dispatch backend AFTER:1,2 Deploy after tests\n' +
              '    /dispatch api PRIORITY:high Urgent fix'
            )]);
          } else {
            const agent = parts[1];
            const dependsOn = parts[2]?.split(',').map((s) => s.trim()) || undefined;
            const priority = (parts[3]?.toLowerCase() as 'critical' | 'high' | 'normal' | 'low') || undefined;
            const prompt = parts[4];

            if (!agentNames.includes(agent)) {
              setOrchMessages((prev) => [
                ...prev,
                sysMsg(`Unknown agent: ${agent}. Available: ${agentNames.join(', ')}`),
              ]);
            } else {
              const task = manager.dispatchTask(agent, prompt, { dependsOn, priority });
              updateTasks();
              if (task) {
                const deps = dependsOn ? ` (after #${dependsOn.join(', #')})` : '';
                const prio = priority && priority !== 'normal' ? ` [${priority}]` : '';
                const status = task.status === 'blocked' ? '⏳ blocked' : '▶ queued';
                setOrchMessages((prev) => [...prev, sysMsg(`✓ #${task.id} → ${agent}${prio}${deps} - ${status}`)]);
              }
            }
          }
          break;
        }

        case '/broadcast': {
          if (!args.trim()) {
            setOrchMessages((prev) => [...prev, sysMsg('Usage: /broadcast <prompt>')]);
          } else {
            for (const name of agentNames) {
              manager.dispatchTask(name, args);
            }
            updateTasks();
            setOrchMessages((prev) => [
              ...prev,
              sysMsg(`✓ Broadcast to ${agentNames.length} agents: ${args}`),
            ]);
          }
          break;
        }

        case '/status': {
          const lines = agentNames.map((name) => {
            const state = states.get(name) ?? 'idle';
            const icon = state === 'running' ? '🟢' : state === 'paused' ? '🟡' : state === 'error' ? '🔴' : '⚪';
            return `  ${icon} ${name}: ${state}`;
          });
          setOrchMessages((prev) => [...prev, sysMsg('Agent States:\n' + lines.join('\n'))]);
          break;
        }

        case '/agents': {
          const lines = config.projects.map((p, i) => {
            const state = states.get(p.name) ?? 'idle';
            const icon = state === 'running' ? '🟢' : state === 'paused' ? '🟡' : state === 'error' ? '🔴' : '⚪';
            return `  ${i + 1}. ${icon} ${p.name}\n     └─ ${p.path}`;
          });
          setOrchMessages((prev) => [
            ...prev,
            sysMsg(`Configured Agents (${config.projects.length}):\n` + lines.join('\n')),
          ]);
          break;
        }

        case '/queue': {
          const running = tasks.filter((t) => t.status === 'running');
          const pending = tasks.filter((t) => t.status === 'pending');
          const blocked = tasks.filter((t) => t.status === 'blocked');
          const done = tasks.filter((t) => t.status === 'done');
          const error = tasks.filter((t) => t.status === 'error');

          let queueText = `Task Queue:\n`;

          // Running tasks
          queueText += `\n  🟢 Running (${running.length}):\n`;
          running.forEach((t) => {
            const prio = t.priority !== 'normal' ? ` [${t.priority}]` : '';
            queueText += `    #${t.id} [${t.projectName}]${prio} ${t.prompt.slice(0, 45)}...\n`;
          });

          // Pending tasks (ready to run)
          queueText += `\n  ⏳ Pending (${pending.length}):\n`;
          pending.slice(0, 5).forEach((t) => {
            const prio = t.priority !== 'normal' ? ` [${t.priority}]` : '';
            queueText += `    #${t.id} [${t.projectName}]${prio} ${t.prompt.slice(0, 45)}...\n`;
          });
          if (pending.length > 5) queueText += `    ... and ${pending.length - 5} more\n`;

          // Blocked tasks (waiting for dependencies)
          if (blocked.length > 0) {
            queueText += `\n  🔒 Blocked (${blocked.length}):\n`;
            blocked.slice(0, 5).forEach((t) => {
              const deps = t.dependsOn.join(', #');
              queueText += `    #${t.id} [${t.projectName}] waiting for #${deps}\n`;
              queueText += `       └─ ${t.prompt.slice(0, 40)}...\n`;
            });
            if (blocked.length > 5) queueText += `    ... and ${blocked.length - 5} more\n`;
          }

          // Summary
          queueText += `\n  ✓ Done: ${done.length} | ✗ Error: ${error.length}`;

          setOrchMessages((prev) => [...prev, sysMsg(queueText)]);
          break;
        }

        case '/task': {
          if (!args) {
            setOrchMessages((prev) => [...prev, sysMsg('Usage: /task <id>')]);
          } else {
            const task = manager.getTask(args);
            if (!task) {
              setOrchMessages((prev) => [...prev, sysMsg(`Task #${args} not found`)]);
            } else {
              const deps = task.dependsOn.length > 0 ? `\n  Depends on: #${task.dependsOn.join(', #')}` : '';
              const blocks = task.blockedBy.length > 0 ? `\n  Blocks: #${task.blockedBy.join(', #')}` : '';
              const result = task.result ? `\n  Result: ${task.result}` : '';
              const error = task.error ? `\n  Error: ${task.error}` : '';
              const duration = task.startedAt && task.completedAt
                ? `\n  Duration: ${((task.completedAt - task.startedAt) / 1000).toFixed(1)}s`
                : '';

              setOrchMessages((prev) => [...prev, sysMsg(
                `Task #${task.id}:\n` +
                `  Agent: ${task.projectName}\n` +
                `  Status: ${task.status}\n` +
                `  Priority: ${task.priority}\n` +
                `  Prompt: ${task.prompt}` +
                deps + blocks + result + error + duration
              )]);
            }
          }
          break;
        }

        case '/cancel': {
          if (!args) {
            setOrchMessages((prev) => [...prev, sysMsg('Usage: /cancel <task-id>')]);
          } else {
            const task = manager.getTask(args);
            if (!task) {
              setOrchMessages((prev) => [...prev, sysMsg(`Task #${args} not found`)]);
            } else if (task.status === 'done' || task.status === 'cancelled') {
              setOrchMessages((prev) => [...prev, sysMsg(`Task #${args} already ${task.status}`)]);
            } else {
              const blockedCount = task.blockedBy.length;
              manager.cancelTask(args, 'Cancelled by user');
              updateTasks();
              const msg = blockedCount > 0
                ? `✓ Cancelled task #${args} and ${blockedCount} dependent task(s)`
                : `✓ Cancelled task #${args}`;
              setOrchMessages((prev) => [...prev, sysMsg(msg)]);
            }
          }
          break;
        }

        case '/stop':
          if (!args) {
            setOrchMessages((prev) => [...prev, sysMsg('Usage: /stop <agent|all>')]);
          } else if (args === 'all') {
            for (const name of agentNames) {
              manager.stopAgent(name);
            }
            setOrchMessages((prev) => [...prev, sysMsg(`✓ Stopped all ${agentNames.length} agents`)]);
          } else if (agentNames.includes(args)) {
            manager.stopAgent(args);
            setOrchMessages((prev) => [...prev, sysMsg(`✓ Stopped ${args}`)]);
          } else {
            setOrchMessages((prev) => [
              ...prev,
              sysMsg(`Unknown agent: ${args}. Available: ${agentNames.join(', ')}`),
            ]);
          }
          break;

        case '/pause':
          if (!args) {
            setOrchMessages((prev) => [...prev, sysMsg('Usage: /pause <agent|all>')]);
          } else if (args === 'all') {
            for (const name of agentNames) {
              manager.pauseAgent(name);
            }
            setOrchMessages((prev) => [...prev, sysMsg(`✓ Paused all agents`)]);
          } else if (agentNames.includes(args)) {
            manager.pauseAgent(args);
            setOrchMessages((prev) => [...prev, sysMsg(`✓ Paused ${args}`)]);
          } else {
            setOrchMessages((prev) => [
              ...prev,
              sysMsg(`Unknown agent: ${args}. Available: ${agentNames.join(', ')}`),
            ]);
          }
          break;

        case '/resume':
          if (!args) {
            setOrchMessages((prev) => [...prev, sysMsg('Usage: /resume <agent|all>')]);
          } else if (args === 'all') {
            for (const name of agentNames) {
              manager.resumeAgent(name);
            }
            setOrchMessages((prev) => [...prev, sysMsg(`✓ Resumed all agents`)]);
          } else if (agentNames.includes(args)) {
            manager.resumeAgent(args);
            setOrchMessages((prev) => [...prev, sysMsg(`✓ Resumed ${args}`)]);
          } else {
            setOrchMessages((prev) => [
              ...prev,
              sysMsg(`Unknown agent: ${args}. Available: ${agentNames.join(', ')}`),
            ]);
          }
          break;

        case '/focus': {
          if (!args) {
            setOrchMessages((prev) => [...prev, sysMsg('Usage: /focus <agent>')]);
          } else {
            const idx = agentNames.indexOf(args);
            if (idx === -1) {
              setOrchMessages((prev) => [
                ...prev,
                sysMsg(`Unknown agent: ${args}. Available: ${agentNames.join(', ')}`),
              ]);
            } else {
              setSelectedAgentIndex(idx);
              setActivePanel('agents');
              setOrchMessages((prev) => [...prev, sysMsg(`✓ Focused on ${args}`)]);
            }
          }
          break;
        }

        case '/restart': {
          if (!args) {
            setOrchMessages((prev) => [...prev, sysMsg('Usage: /restart <agent>')]);
          } else if (agentNames.includes(args)) {
            manager.stopAgent(args);
            // Small delay then restart
            setTimeout(() => {
              const agent = manager.getAgent(args);
              if (agent) agent.start();
            }, 500);
            setOrchMessages((prev) => [...prev, sysMsg(`✓ Restarting ${args}...`)]);
          } else {
            setOrchMessages((prev) => [
              ...prev,
              sysMsg(`Unknown agent: ${args}. Available: ${agentNames.join(', ')}`),
            ]);
          }
          break;
        }

        // ══════════════════════════════════════════════════════════════════════
        // Session Commands
        // ══════════════════════════════════════════════════════════════════════
        case '/save':
          persistState();
          setOrchMessages((prev) => [
            ...prev,
            sysMsg(`✓ Session saved to ${STATE_PATH}`),
          ]);
          break;

        case '/load': {
          const loaded = loadState(STATE_PATH);
          if (loaded) {
            if (loaded.orchMessages) {
              setOrchMessages(loaded.orchMessages);
            }
            setOrchMessages((prev) => [
              ...prev,
              sysMsg(`✓ Session loaded from ${STATE_PATH}`),
            ]);
          } else {
            setOrchMessages((prev) => [...prev, sysMsg(`No saved session found at ${STATE_PATH}`)]);
          }
          break;
        }

        case '/reset':
          manager.stopAll();
          setOrchMessages([]);
          setTasks([]);
          setTimeout(() => manager.startAll(), 500);
          setOrchMessages((prev) => [...prev, sysMsg('✓ All agents reset, state cleared')]);
          break;

        default:
          setOrchMessages((prev) => [
            ...prev,
            sysMsg(`Unknown command: ${command}. Type /help for available commands.`),
          ]);
      }
    },
    [manager, orchestrator, agentNames, states, orchMessages, tasks, config, updateTasks, persistState, setSelectedAgentIndex, setActivePanel],
  );

  const handleStopAgent = useCallback(
    (name: string) => {
      manager.stopAgent(name);
    },
    [manager],
  );

  const handleTogglePause = useCallback(
    (name: string) => {
      const agent = manager.getAgent(name);
      if (!agent) return;
      if (agent.state === 'paused') {
        manager.resumeAgent(name);
      } else if (agent.state === 'running') {
        manager.pauseAgent(name);
      }
    },
    [manager],
  );

  const handleSetPanel = useCallback((panel: PanelId) => {
    setActivePanel(panel);
  }, []);

  const handleNavigate = useCallback(
    (delta: number) => {
      if (activePanel === 'agents') {
        setSelectedAgentIndex((prev) => {
          const next = prev + delta;
          if (next < 0) return agentNames.length - 1;
          if (next >= agentNames.length) return 0;
          return next;
        });
      } else if (activePanel === 'orch') {
        setOrchScrollOffset((prev) => Math.max(0, prev + (delta < 0 ? -1 : 1)));
      }
    },
    [activePanel, agentNames.length],
  );


  const handleToggleHelp = useCallback(() => {
    setShowHelp((prev) => !prev);
  }, []);

  // Question handling
  const handleAnswerQuestion = useCallback(
    (questionId: string, answer: string) => {
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === questionId
            ? { ...q, status: 'answered' as const, answer }
            : q
        )
      );
      // TODO: Resume the agent session with the answer
      const question = questions.find((q) => q.id === questionId);
      if (question) {
        const sysMsg: OrchestratorMessage = {
          role: 'system',
          content: `[${question.agentName}] answered: ${answer}`,
          timestamp: Date.now(),
        };
        setOrchMessages((prev) => [...prev, sysMsg]);
      }
    },
    [questions]
  );

  const handleDismissQuestion = useCallback(
    (questionId: string) => {
      setQuestions((prev) => prev.filter((q) => q.id !== questionId));
    },
    []
  );

  const handleSelectQuestion = useCallback(
    (index: number) => {
      setSelectedQuestionIndex(index);
    },
    []
  );

  useEffect(() => {
    if (orchMessages.length > 0) {
      persistState();
    }
  }, [orchMessages.length]);

  const focusedAgent = agentNames[selectedAgentIndex] ?? '';
  const agents = agentNames.map((name) => ({ name, state: states.get(name) ?? ('idle' as AgentState) }));

  if (showHelp) {
    return (
      <Box flexDirection="column" height={termHeight - 1}>
        <HelpPopup onClose={handleToggleHelp} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={termHeight - 1}>
      <Box flexGrow={1} flexDirection="row">
        {/* Left column: 20% width — sessions + task queue */}
        <Box flexDirection="column" width="20%">
          <SidebarPane
            agents={agents}
            projects={config.projects}
            tasks={tasks}
            focused={activePanel === 'agents'}
            selectedAgentIndex={selectedAgentIndex}
          />
        </Box>
        {/* Center column: 55% width — orchestrator (main conversation) */}
        <Box flexDirection="column" width="55%">
          <OrchestratorPane
            messages={orchMessages}
            running={orchRunning}
            focused={activePanel === 'orch'}
            scrollOffset={orchScrollOffset}
            onSendMessage={handleSendOrchestratorMessage}
            onSlashCommand={handleSlashCommand}
            onEditingChange={setOrchEditing}
            onBlur={() => setActivePanel('agents')}
          />
        </Box>
        {/* Right column: 25% width — questions with answers */}
        <Box flexDirection="column" width="25%">
          <QuestionsPane
            questions={questions}
            focused={activePanel === 'questions'}
            selectedIndex={selectedQuestionIndex}
            onSelectQuestion={handleSelectQuestion}
            onAnswer={handleAnswerQuestion}
            onDismiss={handleDismissQuestion}
          />
        </Box>
      </Box>
      <CommandBar
        focusedAgent={focusedAgent}
        agentNames={agentNames}
        activePanel={activePanel}
        onSendPrompt={handleSendPrompt}
        onQuit={handleQuit}
        onStopAgent={handleStopAgent}
        onTogglePause={handleTogglePause}
        onSetPanel={handleSetPanel}
        onNavigate={handleNavigate}
        onToggleHelp={handleToggleHelp}
        onAddWorkspace={handleAddWorkspace}
        onRemoveWorkspace={handleRemoveWorkspace}
        orchEditing={orchEditing || showBrowser}
      />
      {/* Directory Browser Modal - Centered */}
      {showBrowser && (
        <Box
          position="absolute"
          flexDirection="column"
          justifyContent="center"
          alignItems="center"
          width="100%"
          height="100%"
        >
          <DirectoryBrowser
            initialPath="~/"
            existingProjects={projects.map((p) => p.path)}
            onSelect={handleSelectWorkspace}
            onCancel={handleCancelBrowser}
          />
        </Box>
      )}
    </Box>
  );
}
