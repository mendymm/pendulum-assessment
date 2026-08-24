/**
 * vibe coded quick script, spawns the gateway and the simulation nodes
 * shows me the stdout/stderr of the spawned processes in live TUI
 */

import { type ChildProcess, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { RUNTIME_CONFIG } from "@pendulum/shared/src/config";

// packages/scripts/src -> repo root
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TSX_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsx");

// how often we redraw the dashboard
const REFRESH_HZ = 10;
const REFRESH_MS = 1000 / REFRESH_HZ;
// how many of the most recent output lines we keep/show per process
const LINES_PER_PROC = 5;

interface Command {
  label: string;
  args: string[];
}

interface ManagedProcess {
  label: string;
  child: ChildProcess;
  recent: string[];
}

// which processes' output the dashboard shows. Both default on; disable with the negated
// flags (--no-gateway-logs / --no-node-logs). Hidden processes still spawn and run — we
// just don't render their output.
interface LogOptions {
  gatewayLogs: boolean;
  nodeLogs: boolean;
}

const HELP_TEXT = `Usage: tsx packages/scripts/src/startSimulation.ts [options]

Spawns the gateway and ${RUNTIME_CONFIG.simCount} simulation nodes, showing their live output
in a TUI dashboard.

Options:
  --no-gateway-logs   Hide the gateway's output (still runs)
  --no-node-logs      Hide the sim nodes' output (still run)
  -h, --help          Show this help and exit
`;

function parseLogOptions(): LogOptions {
  const { values } = parseArgs({
    options: {
      "gateway-logs": { type: "boolean", default: true },
      "node-logs": { type: "boolean", default: true },
      help: { type: "boolean", short: "h", default: false },
    },
    allowNegative: true,
  });

  if (values.help) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  return {
    gatewayLogs: values["gateway-logs"] ?? true,
    nodeLogs: values["node-logs"] ?? true,
  };
}

function buildCommands(): Command[] {
  const commands: Command[] = [{ label: "gateway", args: [join(REPO_ROOT, "packages/gateway/src/main.ts")] }];

  for (let nodeId = 0; nodeId < RUNTIME_CONFIG.simCount; nodeId++) {
    commands.push({
      label: `sim-${nodeId}`,
      args: [join(REPO_ROOT, "packages/sim-node/src/main.ts"), String(nodeId)],
    });
  }

  return commands;
}

function spawnProcess(command: Command): ManagedProcess {
  const child = spawn(TSX_BIN, command.args, {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const managed: ManagedProcess = { label: command.label, child, recent: [] };

  // stdout and stderr are merged into a single recent-lines ring buffer,
  // since the dashboard only shows the last couple of lines per process.
  const consume = (chunk: Buffer) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed.length === 0) continue;
      managed.recent.push(trimmed);
      if (managed.recent.length > LINES_PER_PROC) managed.recent.shift();
    }
  };

  child.stdout?.on("data", consume);
  child.stderr?.on("data", consume);
  child.on("exit", (code) => {
    managed.recent.push(`<exited with code ${code}>`);
    if (managed.recent.length > LINES_PER_PROC) managed.recent.shift();
  });

  return managed;
}

function render(processes: ManagedProcess[], options: LogOptions) {
  // clear screen and move cursor to home
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(`pendulum simulation — ${new Date().toISOString()}\n\n`);

  // render the gateway below all other nodes, hiding whichever the flags disabled
  const ordered = [...processes]
    .filter((proc) => (proc.label === "gateway" ? options.gatewayLogs : options.nodeLogs))
    .sort((a, b) => {
      if (a.label === "gateway") return 1;
      if (b.label === "gateway") return -1;
      return 0;
    });

  for (const proc of ordered) {
    process.stdout.write(`[${proc.label}] (pid ${proc.child.pid})\n`);
    const lines = proc.recent.length > 0 ? proc.recent : ["<no output yet>"];
    for (const line of lines) {
      process.stdout.write(`  ${line}\n`);
    }
    process.stdout.write("\n");
  }
}

function main() {
  const options = parseLogOptions();
  const processes = buildCommands().map(spawnProcess);

  render(processes, options);
  const timer = setInterval(() => render(processes, options), REFRESH_MS);

  const shutdown = () => {
    clearInterval(timer);
    for (const proc of processes) {
      proc.child.kill("SIGTERM");
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
