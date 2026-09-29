export const DASHBOARD_USER = {
  name: 'badr',
  email: 'badr@troxe.host',
  plan: 'Pro',
  role: 'Admin',
};

export const OVERVIEW_STATS = [
  { label: 'Total servers', value: '4', hint: 'across 4 runtimes', icon: 'server' },
  { label: 'Role', value: 'Admin', hint: 'full access', icon: 'shield' },
  { label: 'Current session', value: 'Cairo, EG', hint: '197.32.11.8 • Chrome', icon: 'globe' },
  { label: 'Avg. uptime', value: '99.98%', hint: 'last 30 days', icon: 'clock' },
];

export const CURRENT_SESSION = {
  device: 'Chrome 128 — Windows 11',
  ip: '197.32.11.8',
  location: 'Cairo, Egypt',
  countryCode: 'eg',
  started: 'Sat, Sep 27, 2026 — 09:14:52',
};

export const LOGIN_HISTORY = [
  {
    id: 1,
    status: 'success',
    current: true,
    ip: '197.32.11.8',
    location: 'Cairo, Egypt',
    countryCode: 'eg',
    device: 'Chrome 128 — Windows 11',
    date: 'Sat, Sep 27, 2026 — 09:14:52',
  },
  {
    id: 2,
    status: 'success',
    ip: '197.32.11.8',
    location: 'Cairo, Egypt',
    countryCode: 'eg',
    device: 'Troxe App — Android 14',
    date: 'Fri, Sep 26, 2026 — 22:41:07',
  },
  {
    id: 3,
    status: 'failed',
    ip: '45.148.90.211',
    location: 'Frankfurt, Germany',
    countryCode: 'de',
    device: 'Unknown — cURL',
    date: 'Fri, Sep 26, 2026 — 03:17:44',
  },
  {
    id: 4,
    status: 'success',
    ip: '94.96.201.55',
    location: 'Riyadh, Saudi Arabia',
    countryCode: 'sa',
    device: 'Safari 18 — iPhone 16',
    date: 'Thu, Sep 25, 2026 — 18:02:31',
  },
  {
    id: 5,
    status: 'success',
    ip: '197.32.11.8',
    location: 'Cairo, Egypt',
    countryCode: 'eg',
    device: 'Chrome 128 — Windows 11',
    date: 'Wed, Sep 24, 2026 — 11:56:19',
  },
  {
    id: 6,
    status: 'failed',
    ip: '172.183.44.90',
    location: 'Virginia, USA',
    countryCode: 'us',
    device: 'Unknown — Python script',
    date: 'Tue, Sep 23, 2026 — 07:29:03',
  },
  {
    id: 7,
    status: 'success',
    ip: '86.51.120.74',
    location: 'Dubai, UAE',
    countryCode: 'ae',
    device: 'Edge 128 — Windows 11',
    date: 'Mon, Sep 22, 2026 — 15:44:58',
  },
];

export const SERVERS = [
  {
    id: 'discord-main',
    name: 'discord-main',
    runtime: 'Node.js',
    status: 'online',
    cpu: 12,
    ram: 38,
    uptime: '14d 6h',
  },
  {
    id: 'telegram-shop',
    name: 'telegram-shop',
    runtime: 'Python',
    status: 'online',
    cpu: 8,
    ram: 24,
    uptime: '9d 2h',
  },
  {
    id: 'api-backend',
    name: 'api-backend',
    runtime: 'Bun',
    status: 'online',
    cpu: 31,
    ram: 52,
    uptime: '21d 11h',
  },
  {
    id: 'test-playground',
    name: 'test-playground',
    runtime: 'PHP',
    status: 'offline',
    cpu: 0,
    ram: 0,
    uptime: '—',
  },
];

export const SERVER_LOGS = {
  'discord-main': [
    '[14:02:11] Connected to Discord gateway (shard 0/1)',
    '[14:02:11] Loaded 24 slash commands in 812ms',
    '[14:05:44] Guild joined: Dev Hub (+1,248 members)',
    '[14:11:03] Heartbeat acknowledged (42ms)',
  ],
  'telegram-shop': [
    '[14:01:57] Polling @TroxeShopBot — no pending updates',
    '[14:06:20] Order #1841 confirmed (42.50 USD)',
    '[14:09:55] Webhook delivered: payment.succeeded',
  ],
  'api-backend': [
    '[14:00:02] Bun v1.2 listening on :3000',
    '[14:03:37] GET /api/status → 200 (3ms)',
    '[14:10:19] GET /api/orders → 200 (11ms)',
    '[14:12:48] Autosave checkpoint written (db.sqlite)',
  ],
  'test-playground': ['[—] Server is offline. Start it to stream logs.'],
};

const DEFAULT_FILES = {
  'bot.js': { type: 'file', size: '12.4 KB', modified: 'Sep 27, 2026' },
  'package.json': { type: 'file', size: '1.1 KB', modified: 'Sep 26, 2026' },
  'config': {
    type: 'dir',
    children: {
      'settings.json': { type: 'file', size: '0.8 KB', modified: 'Sep 25, 2026' },
      '.env.example': { type: 'file', size: '0.3 KB', modified: 'Sep 20, 2026' },
    },
  },
  'logs': {
    type: 'dir',
    children: {
      'out.log': { type: 'file', size: '2.6 MB', modified: 'Sep 27, 2026' },
      'error.log': { type: 'file', size: '14 KB', modified: 'Sep 26, 2026' },
    },
  },
  'data': {
    type: 'dir',
    children: {
      'database.sqlite': { type: 'file', size: '8.2 MB', modified: 'Sep 27, 2026' },
    },
  },
};

const DETAIL_OVERRIDES = {
  'discord-main': {
    plan: 'Pro — $2/mo',
    region: 'Frankfurt, DE',
    ip: '49.12.88.201',
    runtimeVersion: 'Node.js 20.11',
    storageUsed: '2.1 GB of 5 GB',
    startup: 'node bot.js',
    env: [
      { k: 'DISCORD_TOKEN', v: '••••••••••••' },
      { k: 'PREFIX', v: '!' },
    ],
    backups: [
      { id: 'b1', name: 'auto-sep-27-0600', size: '1.2 GB', date: 'Sep 27, 2026 — 06:00', auto: true },
      { id: 'b2', name: 'auto-sep-26-0600', size: '1.2 GB', date: 'Sep 26, 2026 — 06:00', auto: true },
      { id: 'b3', name: 'before-update-v2.4', size: '1.1 GB', date: 'Sep 24, 2026 — 15:32', auto: false },
    ],
  },
  'telegram-shop': {
    plan: 'Starter — $1/mo',
    region: 'Frankfurt, DE',
    ip: '49.12.88.202',
    runtimeVersion: 'Python 3.11',
    storageUsed: '1.4 GB of 3 GB',
    startup: 'python bot.py',
    env: [
      { k: 'BOT_TOKEN', v: '••••••••••••' },
      { k: 'SHOP_ID', v: '1841' },
    ],
    backups: [
      { id: 'b1', name: 'auto-sep-27-0600', size: '0.9 GB', date: 'Sep 27, 2026 — 06:00', auto: true },
      { id: 'b2', name: 'auto-sep-26-0600', size: '0.9 GB', date: 'Sep 26, 2026 — 06:00', auto: true },
    ],
  },
  'api-backend': {
    plan: 'Premium — $3/mo',
    region: 'Virginia, US',
    ip: '172.66.41.90',
    runtimeVersion: 'Bun 1.2',
    storageUsed: '3.8 GB of 6 GB',
    startup: 'bun run start',
    env: [
      { k: 'DATABASE_URL', v: '••••••••••••' },
      { k: 'PORT', v: '3000' },
    ],
    backups: [
      { id: 'b1', name: 'auto-sep-27-0600', size: '2.4 GB', date: 'Sep 27, 2026 — 06:00', auto: true },
      { id: 'b2', name: 'pre-migration', size: '2.3 GB', date: 'Sep 22, 2026 — 11:05', auto: false },
    ],
  },
  'test-playground': {
    plan: 'Free — $0/mo',
    region: 'Frankfurt, DE',
    ip: '49.12.88.203',
    runtimeVersion: 'PHP 8.3',
    storageUsed: '0.2 GB of 1 GB',
    startup: 'php -S 0.0.0.0:8080',
    env: [{ k: 'APP_ENV', v: 'testing' }],
    backups: [],
  },
};

export function getServerDetail(id) {
  const base = SERVERS.find((s) => s.id === id);
  if (!base) return null;
  const over = DETAIL_OVERRIDES[id] ?? {};
  return {
    ...base,
    plan: 'Free — $0/mo',
    region: 'Frankfurt, DE',
    ip: '—',
    runtimeVersion: base.runtime,
    storageUsed: '—',
    startup: '',
    env: [],
    backups: [],
    files: DEFAULT_FILES,
    ...over,
  };
}

export const CONSOLE_POOL = [
  'Heartbeat acknowledged (38ms)',
  'GET /health → 200 (2ms)',
  'Autosave checkpoint written',
  'Cache hit ratio 94.2%',
  'Worker pool idle (4/4 free)',
  'Memory usage stable at 41%',
];
