/**
 * Landing-page content, in one place.
 *
 * Everything here reflects what the platform ACTUALLY does today (verified
 * against the backend): four server runtimes (Node.js, Python, Bun, PHP — the
 * `server_runtime` enum), a dedicated container per server, live CPU/RAM/disk
 * metrics, console + log tail, file management, per-plan backup slots,
 * auto-restart, encrypted environment variables, per-server network hardening,
 * an activity trail, and the support-ticket system.
 *
 * Deliberately NOT claimed anywhere on this page: uptime percentages, DDoS
 * protection, managed databases (MySQL/PostgreSQL/Mongo/Redis are not
 * provisionable here), free migrations, overage billing, refunds, or support
 * response times. Prices and resources come from the live `/plans` API.
 */

export const RUNTIMES = [
    {
        id: 'node',
        name: 'Node.js',
        Icon: 'IconNode',
        blurb: 'Discord, Telegram and Slack bots, APIs, and anything on npm.',
    },
    {
        id: 'python',
        name: 'Python',
        Icon: 'IconPython',
        blurb: 'Bots, workers and scripts from a requirements.txt.',
    },
    {
        id: 'bun',
        name: 'Bun',
        Icon: 'IconBun',
        blurb: 'A fast TypeScript runtime for the same code you already ship.',
    },
    {
        id: 'php',
        name: 'PHP',
        Icon: 'IconPhp',
        blurb: 'Classic web apps, cron scripts and small sites.',
    },
];

/** Bento grid: what a customer can do with a server today. */
export const CAPABILITIES = [
    {
        id: 'create',
        title: 'Create a server in seconds',
        text: 'Pick a runtime, set your startup command and variables, and a dedicated container is provisioned for you.',
        span: 'wide',
        visual: 'command',
    },
    {
        id: 'metrics',
        title: 'Live resource metrics',
        text: 'CPU, memory and disk usage stream into your dashboard while the server runs.',
        visual: 'metrics',
    },
    {
        id: 'console',
        title: 'Console and logs',
        text: 'Open a shell, watch stdout and stderr, and see the last error when a run fails.',
        visual: 'logs',
    },
    {
        id: 'files',
        title: 'File manager',
        text: 'Browse, edit and upload files in the browser — no FTP client or SSH keys required.',
    },
    {
        id: 'backups',
        title: 'Backups',
        text: 'Automatic and manual snapshots, with the number of slots your plan allows.',
    },
    {
        id: 'restart',
        title: 'Auto-restart',
        text: 'If a process exits, the platform brings the container back on its own.',
    },
    {
        id: 'env',
        title: 'Encrypted environment variables',
        text: 'Secrets are stored encrypted and shown masked — never in plain text.',
    },
    {
        id: 'support',
        title: 'Support tickets',
        text: 'Talk to a specialist inside the dashboard, with the linked server attached to the ticket.',
        span: 'wide',
    },
];

/** Why Troxe — each line maps to something real in the codebase. */
export const WHY = [
    {
        id: 'isolation',
        title: 'One container per server',
        text: 'Every server gets its own container, network and volume, so one project cannot touch another.',
    },
    {
        id: 'visibility',
        title: 'You see what it is using',
        text: 'Live CPU, RAM and disk against your plan limits — no guessing whether you need an upgrade.',
    },
    {
        id: 'control',
        title: 'Real control from the browser',
        text: 'Console, logs, files, backups, startup and variables — the things you normally need SSH for.',
    },
    {
        id: 'hardening',
        title: 'Network hardening by default',
        text: 'Each server network is configured with its own ruleset when it is provisioned.',
    },
    {
        id: 'recovery',
        title: 'Recovery built in',
        text: 'Auto-restart, backup slots per plan, and an activity trail of every action on the server.',
    },
    {
        id: 'support',
        title: 'Help that stays with the ticket',
        text: 'The conversation, the linked server and its logs are all attached to the ticket.',
    },
];

export const STEPS = [
    { id: 'account', title: 'Create your account', text: 'Email, Google or Discord — the free plan needs no card.' },
    { id: 'plan', title: 'Pick a plan', text: 'Start free, or choose the RAM, CPU and storage you need.' },
    { id: 'server', title: 'Create a server', text: 'Choose Node.js, Python, Bun or PHP and set your startup command.' },
    { id: 'manage', title: 'Watch it run', text: 'Metrics, logs, files, backups and support, all in the dashboard.' },
];

/**
 * FAQ — answers only cover what the platform really does. Open questions
 * (refunds, overages, migrations, support response times) are answered honestly
 * with what exists today instead of a promised policy.
 */
export const FAQS = [
    {
        q: 'Which runtimes can I run?',
        a: 'Node.js, Python, Bun and PHP. Anything that runs on one of them works — Discord, Telegram and Slack bots, APIs, web apps, workers and scripts.',
    },
    {
        q: 'How do I start?',
        a: 'Create an account, pick a plan (the free one needs no card), then create a server by choosing a runtime and a startup command.',
    },
    {
        q: 'What is the difference between the plans?',
        a: 'CPU, RAM, storage, how many servers you can run and how many backup slots you get. Prices are listed above and come straight from the plan list.',
    },
    {
        q: 'How do I manage a server?',
        a: 'From the dashboard: start and stop it, open a console, read the logs, edit files, set environment variables and restore a backup.',
    },
    {
        q: 'Can I change my plan later?',
        a: 'Yes. Plans can be changed from the dashboard, and a change takes effect the next time the platform evaluates your servers.',
    },
    {
        q: 'How do backups work?',
        a: 'Each plan includes a number of backup slots. Backups can be taken automatically or on demand, and a snapshot can be restored to a server.',
    },
    {
        q: 'How do I get help?',
        a: 'Open a ticket from the dashboard. You can attach the server involved, so the specialist sees the right logs and status from the start.',
    },
    {
        q: 'Do you have databases?',
        a: 'Not as a managed product yet. You can run a database inside your own server if your project needs one.',
    },
    {
        q: 'Is there a free plan?',
        a: 'Yes — one small server with 256MB RAM and one backup slot, no card required.',
    },
];

/** Only routes that exist in App.jsx. Nothing here may dangle. */
export const FOOTER_LINKS = {
    product: [
        { label: 'Features', to: '/features' },
        { label: 'Services', to: '/services' },
        { label: 'Pricing', to: '/pricing' },
        { label: 'Support tickets', to: '/dashboard/support' },
    ],
    company: [
        { label: 'About', to: '/about' },
        { label: 'Contact', to: '/contact' },
        { label: 'FAQ', to: '/faq' },
    ],
    account: [
        { label: 'Sign in', to: '/signin' },
        { label: 'Create account', to: '/signup' },
        { label: 'Dashboard', to: '/dashboard' },
    ],
    legal: [
        { label: 'Terms', to: '/terms' },
        { label: 'Privacy', to: '/privacy' },
    ],
};
