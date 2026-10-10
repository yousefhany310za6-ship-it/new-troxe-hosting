import { IconDiscord, IconTelegram, IconSlack, IconNode, IconBun, IconPython, IconPhp, IconZap } from '../components/icons.jsx';

/**
 * What the platform can actually run today.
 *
 * The only provisionable runtimes are the four in the backend `server_runtime`
 * enum (Node.js, Python, Bun, PHP). Everything else here is a *use case* that
 * runs on one of them — not a separate product. Types that are NOT supported
 * are deliberately absent: Go, Rust, static-site hosting, and managed
 * MySQL/PostgreSQL/MongoDB/Redis databases.
 */
export const SERVICE_GROUPS = [
    {
        label: 'Runtimes',
        items: [
            {
                Icon: IconNode,
                name: 'Node.js',
                details:
                    'The default for Discord, Telegram and Slack bots. Pick the Node version you need, set your startup command, and the platform keeps the container running with metrics, logs and a console.',
            },
            {
                Icon: IconBun,
                name: 'Bun',
                details:
                    'A fast TypeScript runtime for the same code you already ship. Use it when you want faster installs and a modern toolchain.',
            },
            {
                Icon: IconPython,
                name: 'Python',
                details:
                    'Bots, workers and scripts from a requirements.txt. Watch stdout in the console, edit files in the browser and restart from the dashboard.',
            },
            {
                Icon: IconPhp,
                name: 'PHP',
                details:
                    'Classic web apps, cron scripts and small sites. Environment variables are stored encrypted and injected at start.',
            },
        ],
    },
    {
        label: 'What people run on them',
        items: [
            {
                Icon: IconDiscord,
                name: 'Discord bots',
                details:
                    'A Node.js or Python process, its own container, live CPU and RAM, and logs you can read while it is running.',
            },
            {
                Icon: IconTelegram,
                name: 'Telegram bots',
                details:
                    'Long-polling or webhook, with auto-restart so a crash does not leave your bot offline until you notice.',
            },
            {
                Icon: IconSlack,
                name: 'Slack apps',
                details:
                    'Socket Mode or HTTP endpoints, with the console and log tail next to the metrics.',
            },
            {
                Icon: IconZap,
                name: 'APIs, workers and scripts',
                details:
                    'REST APIs, webhooks, queue workers and scheduled scripts — anything that starts from one command.',
            },
        ],
    },
];
