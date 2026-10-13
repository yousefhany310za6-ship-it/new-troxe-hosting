/**
 * ============================================================
 *  Interactive landing-page demo — fixtures.
 *
 *  IMPORTANT: this module is intentionally self-contained.
 *  It must never import from `@/lib/api.js`, `@/hooks/useQueries`,
 *  `@/context/AuthContext` or anything else that talks to the
 *  backend, because the landing page renders it for anonymous
 *  visitors. Every value below is a hard-coded literal that only
 *  exists in the visitor's browser.
 * ============================================================
 */

/** Accent palette copied from ServerOverview.jsx / ResourceMonitor.jsx. */
export const DEMO_COLORS = {
    cpu: '#38bdf8',
    mem: '#a78bfa',
    disk: '#fbbf24',
    rx: '#4ade80',
    tx: '#fb923c',
    neutral: '#94a3b8',
};

/* ---------------------------------------------------------------
 * The demo server. Field names mirror the real API shape so the
 * markup reads exactly like ServerDetail / ServerOverview.
 * --------------------------------------------------------------- */
export const DEMO_SERVER = {
    id: 'demo-00000000-0000-4000-8000-000000000000',
    name: 'discord-relay',
    runtime: 'Node.js',
    runtimeLabel: 'Node.js 22',
    region: 'fra-de',
    planId: 'starter',
    status: 'online',
    mainFile: 'index.js',
    startup: 'node {{MAIN_FILE}}',
    autoRestart: true,
    autoBackup: true,
    autoBackupRetain: 7,
    port: 3000,
    contactCode: 'TX4821 90KD',
    /** Reserved-TLD host so it can never resolve to a real server. */
    address: 'discord-relay.troxehosting.example',
    createdAt: '2026-08-14T09:12:00.000Z',
    nodeId: 'node-fra-02',
    cpuMilli: 500,
    ramMb: 512,
    storageGb: 3,
};

/** Runtimes offered by the demo runtime switcher. */
export const DEMO_RUNTIMES = [
    { value: 'node22', label: 'Node.js 22', version: 'v22.11.0' },
    { value: 'node20', label: 'Node.js 20', version: 'v20.18.1' },
    { value: 'bun', label: 'Bun', version: '1.1.38' },
    { value: 'python', label: 'Python 3.12', version: '3.12.8' },
];

/** Language versions shown in the Settings tab. */
export const DEMO_VERSIONS = ['v22.11.0', 'v22.10.0', 'v20.18.1', 'v20.17.0'];

/* ---------------------------------------------------------------
 * Formatters — byte-identical to the production ones in
 * ServerOverview.jsx so numbers render exactly like the real UI.
 * --------------------------------------------------------------- */
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
const RATE_UNITS = ['B/s', 'KB/s', 'MB/s', 'GB/s'];

export function fmtBytes(v) {
    const n = Number(v) || 0;
    if (n <= 0) return '0 B';
    let i = 0;
    let x = n;
    while (x >= 1024 && i < BYTE_UNITS.length - 1) {
        x /= 1024;
        i++;
    }
    return `${x.toFixed(x < 10 && i > 0 ? 1 : 0)} ${BYTE_UNITS[i]}`;
}

export function fmtRate(v) {
    const n = Number(v) || 0;
    if (n < 1) return '0 B/s';
    let i = 0;
    let x = n;
    while (x >= 1024 && i < RATE_UNITS.length - 1) {
        x /= 1024;
        i++;
    }
    const d = x < 10 && i > 0 ? 2 : x < 100 && i > 0 ? 1 : 0;
    return `${x.toFixed(d)} ${RATE_UNITS[i]}`;
}

export function fmtPct(p) {
    const n = Number(p) || 0;
    return `${n.toFixed(n > 0 && n < 10 ? 1 : 0)}%`;
}

/** "4d 2h 7m" — same shape as the production uptime formatter. */
export function fmtUptime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d) return `${d}d ${h}h ${m}m`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${sec}s`;
    return `${sec}s`;
}

/**
 * Relative timestamp, computed from a fixed demo epoch so the demo
 * never drifts into the future (and never disagrees with itself
 * between renders). `now` is supplied by the caller.
 */
export function timeAgo(iso, now) {
    const then = new Date(iso).getTime();
    const diff = Math.max(0, (now - then) / 1000);
    if (diff < 10) return 'just now';
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
}

export function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/* ---------------------------------------------------------------
 * Resource snapshot. `wobble()` moves each number a little so the
 * panel feels alive while staying inside a believable envelope.
 * --------------------------------------------------------------- */
const METRICS_BASE = {
    cpu: 18.4,
    memUsed: 214 * 1024 * 1024,
    memLimit: 512 * 1024 * 1024,
    diskUsed: 412 * 1024 * 1024,
    diskLimit: 3 * 1024 * 1024 * 1024,
    rx: 14_820,
    tx: 6_240,
    uptime: 4 * 86400 + 2 * 3600 + 7 * 60 + 38,
};

/** Deterministic pseudo-jitter — no Math.random, so renders match. */
export function wobble(base, tick, spread) {
    const p = (Math.sin(tick * 0.7) + Math.sin(tick * 1.9 + 1.3) + Math.sin(tick * 0.31 + 2.7)) / 3;
    return base * (1 + p * spread);
}

export function metricsAt(tick) {
    const cpu = clamp(wobble(METRICS_BASE.cpu, tick, 0.16), 2, 92);
    const memUsed = clamp(wobble(METRICS_BASE.memUsed, tick + 1.7, 0.08), 48 * 1024 * 1024, METRICS_BASE.memLimit * 0.94);
    const rx = clamp(wobble(METRICS_BASE.rx, tick + 3.1, 0.35), 400, 400_000);
    const tx = clamp(wobble(METRICS_BASE.tx, tick + 5.3, 0.3), 200, 200_000);
    return {
        tick,
        cpu,
        memUsed,
        memLimit: METRICS_BASE.memLimit,
        memPct: (memUsed / METRICS_BASE.memLimit) * 100,
        diskUsed: METRICS_BASE.diskUsed,
        diskLimit: METRICS_BASE.diskLimit,
        diskPct: (METRICS_BASE.diskUsed / METRICS_BASE.diskLimit) * 100,
        rx,
        tx,
        uptime: METRICS_BASE.uptime + tick * 3,
    };
}

function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
}

/** Pre-baked sparkline history so charts draw immediately, with no empty state. */
export const DEMO_SERIES = (() => {
    const cpu = [];
    const net = [];
    for (let i = 0; i < 40; i++) {
        cpu.push(Number(wobble(METRICS_BASE.cpu, i, 0.34).toFixed(1)));
        net.push(Number(wobble(METRICS_BASE.rx + METRICS_BASE.tx, i + 11, 0.45).toFixed(0)));
    }
    return { cpu, net };
})();

/* ---------------------------------------------------------------
 * File manager fixtures. `body` powers the read-only preview.
 *
 * Keys are directory paths; the empty string is the storage root,
 * which matches the `dir` state used by the demo file manager.
 * --------------------------------------------------------------- */
export const DEMO_FILES = {
    '': [
        { name: 'src', type: 'dir', size: null, modifiedAt: '2026-10-09T18:40:00.000Z' },
        { name: 'public', type: 'dir', size: null, modifiedAt: '2026-10-02T11:05:00.000Z' },
        { name: '.env', type: 'file', size: 0.4 * 1024, modifiedAt: '2026-10-11T08:12:00.000Z' },
        {
            name: 'package.json',
            type: 'file',
            size: 1.1 * 1024,
            modifiedAt: '2026-10-10T16:21:00.000Z',
            lang: 'JSON',
            body: `{
  "name": "discord-relay",
  "version": "1.4.2",
  "private": true,
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "node --watch index.js"
  },
  "engines": {
    "node": ">=20"
  }
}`,
        },
        {
            name: 'index.js',
            type: 'file',
            size: 2.4 * 1024,
            modifiedAt: '2026-10-11T08:14:00.000Z',
            lang: 'JavaScript',
            body: `import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './src/config.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent],
});

client.once('ready', () => {
  console.log(\`[relay] online as \${client.user.tag}\`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  console.log(\`[relay] \${message.author.tag}: \${message.content}\`);
});

client.login(config.token);`,
        },
        {
            name: 'README.md',
            type: 'file',
            size: 1.8 * 1024,
            modifiedAt: '2026-09-28T13:47:00.000Z',
            lang: 'Markdown',
            body: `# discord-relay

Relay service for the Troxe Hosting demo workspace.

## How it runs

The startup command is \`node {{MAIN_FILE}}\`, so \`index.js\` is the
entry point. The process is restarted automatically if it exits
with a non-zero code.

## Layout

- \`index.js\` — client bootstrap and message handler
- \`src/\` — config and command modules
- \`public/\` — static files served by the panel`,
        },
    ],
    src: [
        {
            name: 'commands',
            type: 'dir',
            size: null,
            modifiedAt: '2026-10-09T18:40:00.000Z',
        },
        {
            name: 'config.js',
            type: 'file',
            size: 0.7 * 1024,
            modifiedAt: '2026-10-08T09:31:00.000Z',
            lang: 'JavaScript',
            body: `const required = ['DISCORD_TOKEN', 'PREFIX'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(\`Missing environment variable: \${key}\`);
  }
}

export const config = {
  token: process.env.DISCORD_TOKEN,
  prefix: process.env.PREFIX || '!',
  port: Number(process.env.PORT) || 3000,
};`,
        },
        {
            name: 'queue.js',
            type: 'file',
            size: 1.2 * 1024,
            modifiedAt: '2026-10-09T18:40:00.000Z',
            lang: 'JavaScript',
            body: `const pending = [];

/** Push a job and resolve once it is picked up by a worker. */
export function enqueue(job) {
  return new Promise((resolve) => {
    pending.push({ job, resolve });
  });
}

export function drain(handler) {
  while (pending.length) {
    const { job, resolve } = pending.shift();
    resolve(handler(job));
  }
}`,
        },
    ],
    'src/commands': [
        {
            name: 'help.js',
            type: 'file',
            size: 0.6 * 1024,
            modifiedAt: '2026-10-09T18:40:00.000Z',
            lang: 'JavaScript',
            body: `export default {
  name: 'help',
  description: 'List every available command',
  execute() {
    return [
      'help      — list commands',
      'status    — show relay uptime',
      'clear     — reset the message buffer',
    ].join('\\n');
  },
};`,
        },
    ],
    public: [
        {
            name: 'index.html',
            type: 'file',
            size: 0.9 * 1024,
            modifiedAt: '2026-10-02T11:05:00.000Z',
            lang: 'HTML',
            body: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>discord-relay status</title>
  </head>
  <body>
    <main id="app">Loading…</main>
  </body>
</html>`,
        },
    ],
};

/* ---------------------------------------------------------------
 * Backups fixtures.
 * --------------------------------------------------------------- */
export const DEMO_BACKUPS = [
    {
        id: 'bk_7',
        name: 'auto-2026-10-12-0300.tar.gz',
        status: 'ready',
        type: 'auto',
        sizeBytes: 41.8 * 1024 * 1024,
        createdAt: '2026-10-12T03:00:00.000Z',
    },
    {
        id: 'bk_6',
        name: 'auto-2026-10-11-0300.tar.gz',
        status: 'ready',
        type: 'auto',
        sizeBytes: 41.2 * 1024 * 1024,
        createdAt: '2026-10-11T03:00:00.000Z',
    },
    {
        id: 'bk_5',
        name: 'manual-pre-upgrade.tar.gz',
        status: 'ready',
        type: 'manual',
        sizeBytes: 39.6 * 1024 * 1024,
        createdAt: '2026-10-09T19:24:00.000Z',
    },
    {
        id: 'bk_4',
        name: 'auto-2026-10-08-0300.tar.gz',
        status: 'failed',
        type: 'auto',
        sizeBytes: 0,
        createdAt: '2026-10-08T03:00:00.000Z',
        error: 'snapshot timed out after 120s while archiving public/',
    },
];

/** How many snapshots the demo plan may keep. */
export const DEMO_BACKUP_SLOTS = 7;

/* ---------------------------------------------------------------
 * Console: the seeded scrollback and the scripted command set.
 *
 * Every command resolves to plain strings rendered into the log
 * pane. Nothing here shells out, opens a socket, or touches Docker.
 * --------------------------------------------------------------- */
export const DEMO_LOG_SEED = [
    { text: '[relay] starting discord-relay (node 22.11.0)', lvl: 'sys' },
    { text: '[config] loaded 2 environment variables', lvl: null },
    { text: '[relay] client ready, awaiting shards', lvl: null },
    { text: '[relay] connected to gateway as relay#4417', lvl: 'ok' },
    { text: '[relay] watching 6 guilds', lvl: null },
    { text: '[queue] worker pool ready (4 workers)', lvl: 'ok' },
    { text: '[relay] message received in #general from kai#2044', lvl: null },
    { text: '[queue] job handled in 18ms', lvl: null },
    { text: '[relay] heartbeat ok (latency 41ms)', lvl: 'ok' },
];

const C = {
    ok: (text) => ({ text, lvl: 'ok' }),
    sys: (text) => ({ text, lvl: 'sys' }),
    warn: (text) => ({ text, lvl: 'warn' }),
    err: (text) => ({ text, lvl: 'error' }),
    out: (text) => ({ text, lvl: null }),
};

const pad = (s, n) => String(s).padEnd(n, ' ');

/**
 * `run(ctx)` receives the live demo state and returns output lines.
 * Commands that "take time" declare a delay in ms so the caller can
 * show a spinner instead of pretending the work was instant.
 */
export const DEMO_COMMANDS = {
    help: {
        summary: 'list available commands',
        lines: () => [
            C.sys('Available commands:'),
            C.out(`  ${pad('help', 12)}show this list`),
            C.out(`  ${pad('status', 12)}server state, uptime and limits`),
            C.out(`  ${pad('ps', 12)}running processes`),
            C.out(`  ${pad('logs', 12)}tail the last 30 log lines`),
            C.out(`  ${pad('env', 12)}list environment variable names`),
            C.out(`  ${pad('files', 12)}list the working directory`),
            C.out(`  ${pad('start', 12)}start the demo process`),
            C.out(`  ${pad('stop', 12)}stop the demo process`),
            C.out(`  ${pad('restart', 12)}restart the demo process`),
            C.out(`  ${pad('clear', 12)}clear this console`),
            C.out(''),
            C.sys('Everything above is simulated locally — no real commands run.'),
        ],
    },

    status: {
        summary: 'server state, uptime and limits',
        lines: ({ server, m }) => [
            C.out(`  server    ${server.name}`),
            C.out(`  runtime   ${server.runtimeLabel}`),
            C.out(`  status    ${server.status}`),
            C.out(`  uptime    ${fmtUptime(m.uptime)}`),
            C.out(`  cpu       ${fmtPct(m.cpu)} of ${(server.cpuMilli / 1000).toFixed(1)} vCPU`),
            C.out(`  memory    ${fmtBytes(m.memUsed)} / ${fmtBytes(m.memLimit)}`),
            C.out(`  storage   ${fmtBytes(m.diskUsed)} / ${fmtBytes(m.diskLimit)}`),
            C.out(`  port      ${server.port}`),
        ],
    },

    ps: {
        summary: 'running processes',
        lines: ({ server }) => [
            C.out('  PID     COMMAND                 STATE'),
            C.out(`  1       node ${server.mainFile}       ${server.status === 'online' ? 'running' : 'stopped'}`),
            C.out('  7       troxe-supervisor        running'),
            C.out('  12      healthcheck            sleeping'),
        ],
    },

    logs: {
        summary: 'tail the last 30 log lines',
        lines: () => [
            C.sys('--- last 30 lines of /data/logs/relay.log ---'),
            C.out('[relay] heartbeat ok (latency 39ms)'),
            C.out('[relay] message received in #general from sara#1180'),
            C.ok('[queue] job handled in 12ms'),
            C.out('[relay] heartbeat ok (latency 41ms)'),
            C.warn('[queue] job took 890ms — backlog detected'),
            C.ok('[queue] job handled in 14ms'),
            C.out('[relay] cached 6 guilds refreshed'),
            C.ok('[relay] heartbeat ok (latency 38ms)'),
            C.sys('--- end of tail ---'),
        ],
    },

    env: {
        summary: 'list environment variable names',
        lines: () => [
            C.out('  DISCORD_TOKEN    ********'),
            C.out('  PREFIX           !'),
            C.out('  PORT             3000'),
            C.out('  NODE_ENV         production'),
            C.sys('  Values are hidden, exactly as in the real panel.'),
        ],
    },

    files: {
        summary: 'list the working directory',
        lines: () => [
            C.out('  drwxr-xr-x  src'),
            C.out('  drwxr-xr-x  public'),
            C.out('  -rw-r--r--  .env'),
            C.out('  -rw-r--r--  package.json'),
            C.out('  -rw-r--r--  index.js'),
            C.out('  -rw-r--r--  README.md'),
        ],
    },

    start: {
        summary: 'start the demo process',
        delay: 900,
        lines: () => [C.sys('[troxe] starting container…'), C.ok('[relay] online — process listening on port 3000')],
    },

    stop: {
        summary: 'stop the demo process',
        delay: 700,
        lines: () => [C.sys('[troxe] sending SIGTERM…'), C.ok('[relay] stopped cleanly in 240ms')],
    },

    restart: {
        summary: 'restart the demo process',
        delay: 1400,
        lines: () => [
            C.sys('[troxe] restarting container…'),
            C.out('[relay] starting discord-relay (node 22.11.0)'),
            C.ok('[relay] connected to gateway as relay#4417'),
        ],
    },

    about: {
        summary: 'what this console is',
        lines: () => [
            C.sys('This is the interactive demo on the Troxe Hosting landing page.'),
            C.out('The log stream above is a scripted fixture that runs entirely'),
            C.out('in your browser. No SSH session, Docker socket or remote'),
            C.out('server is involved.'),
            C.out(''),
            C.out('Create a free account to get a real console for your own bot.'),
        ],
    },
};

/** Commands offered by the "Demo commands" picker, in display order. */
export const DEMO_COMMAND_LIST = [
    'help',
    'status',
    'ps',
    'logs',
    'env',
    'files',
    'start',
    'stop',
    'restart',
    'about',
];