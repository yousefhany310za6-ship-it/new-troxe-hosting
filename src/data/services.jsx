import {
    IconDiscord,
    IconTelegram,
    IconTwitch,
    IconKick,
    IconReddit,
    IconSlack,
    IconNode,
    IconBun,
    IconPython,
    IconPhp,
    IconGo,
    IconRust,
    IconHtml5,
    IconCss3,
    IconJavascript,
    IconMysql,
    IconPostgres,
    IconMongodb,
    IconRedis,
    IconMinecraft,
    IconFivem,
} from '../components/icons.jsx';

export const SERVICE_GROUPS = [
    {
        label: 'Bot Platforms',
        items: [
            {
                name: 'Discord',
                Icon: IconDiscord,
                iconClassName: 'text-[#5865F2]',
                details:
                    'Host Discord.js, discord.py or any Discord bot with websocket-friendly networking, instant restarts and 24/7 uptime for even the biggest guilds.',
            },
            {
                name: 'Telegram',
                Icon: IconTelegram,
                iconClassName: 'text-[#2AABEE]',
                details:
                    'Run Telegraf, aiogram or raw Bot API bots with fast delivery, webhook support and polling that never sleeps.',
            },
            {
                name: 'Twitch',
                Icon: IconTwitch,
                details:
                    'Chat bots, moderators and channel-point apps stay connected to Twitch IRC and EventSub around the clock.',
            },
            {
                name: 'Kick',
                Icon: IconKick,
                variant: 'wide',
                iconClassName: 'text-[#53FC18]',
                details:
                    'Kick chat bots with low-latency messaging and auto-reconnect, ready for hype trains at any hour.',
            },
            {
                name: 'Reddit',
                Icon: IconReddit,
                details:
                    'PRAW and Snoowrap bots for moderation, auto-replies and scheduled posts — with cron-style scheduling built in.',
            },
            {
                name: 'Slack',
                Icon: IconSlack,
                details:
                    'Slack apps with Bolt or raw APIs: slash commands, modals and event subscriptions on a server that is always awake.',
            },
        ],
    },
    {
        label: 'Runtimes & Frameworks',
        items: [
            {
                name: 'Node.js',
                Icon: IconNode,
                details:
                    'Every LTS version with npm, pnpm and yarn support. Deploy Express, Fastify, Nest or plain scripts in seconds.',
            },
            {
                name: 'Bun',
                Icon: IconBun,
                iconClassName: 'text-[#F5F0E6]',
                details:
                    'Native Bun runtime with installs up to 25x faster. Drop-in compatible with most Node.js projects.',
            },
            {
                name: 'Python',
                Icon: IconPython,
                details:
                    'Python 3.8 through 3.12 with pip and venv handled for you. Perfect for aiogram, discord.py and Flask apps.',
            },
            {
                name: 'PHP',
                Icon: IconPhp,
                iconClassName: 'text-[#777BB3]',
                details:
                    'PHP 8.x with Composer and common extensions preinstalled. Laravel, Symfony or plain scripts just run.',
            },
            {
                name: 'Go',
                Icon: IconGo,
                details:
                    'Single-binary Go builds with module caching. Tiny memory footprint, huge concurrency headroom.',
            },
            {
                name: 'Rust',
                Icon: IconRust,
                details:
                    'Release-profile Rust builds with sccache-style caching so recompiles stay fast and binaries stay lean.',
            },
            {
                name: 'Static Sites',
                variant: 'stack',
                StackIcons: [IconHtml5, IconCss3, IconJavascript],
                details:
                    'HTML, CSS and JS served from a global edge cache with instant deploys on every push. Free TLS included.',
            },
        ],
    },
    {
        label: 'Databases',
        items: [
            {
                name: 'MySQL',
                Icon: IconMysql,
                details:
                    'Managed MySQL 8 with automated backups, one-click restores and a connection URL your app can use instantly.',
            },
            {
                name: 'PostgreSQL',
                Icon: IconPostgres,
                details:
                    'Managed Postgres with extensions, point-in-time recovery options and pooling for busy bots.',
            },
            {
                name: 'MongoDB',
                Icon: IconMongodb,
                details:
                    'Document storage for flexible bot data — user profiles, guild settings and logs without migrations.',
            },
            {
                name: 'Redis',
                Icon: IconRedis,
                details:
                    'In-memory caching, queues and rate-limit counters with sub-millisecond latency next to your app.',
            },
        ],
    },
    {
        label: 'Game Hosting',
        items: [
            {
                name: 'Minecraft',
                Icon: IconMinecraft,
                details:
                    'Paper, Spigot, Forge and Vanilla servers with one-click modpacks, plugins and version switching. Full FTP access and instant setup.',
            },
            {
                name: 'FiveM',
                Icon: IconFivem,
                details:
                    'GTA V roleplay servers with txAdmin, custom resources and OneSync support. High single-thread performance for busy cities.',
            },
        ],
    },
];
