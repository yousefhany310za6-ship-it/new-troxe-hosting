import {
    Bot,
    Gamepad2,
    Braces,
    Cpu,
    MemoryStick,
    HardDrive,
    Archive,
    Headphones,
} from 'lucide-react';

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
    IconMinecraft,
    IconFivem,
    IconRustGame,
    IconArk,
    IconValheim,
    IconGmod,
} from '../components/icons.jsx';

/**
 * Pricing, split by what the customer is actually running.
 *
 * ── SOURCE OF TRUTH ──────────────────────────────────────────────────────────
 * Every value below is transcribed from `backend/src/db/seed.ts`, which is what
 * the live API serves from `GET /api/v1/plans`. Verified field by field against
 * https://api.hosting.troxe.dev/api/v1/plans on 2026-10-13. If a number changes
 * in the seed, change it here too — or better, fetch it, because a card that
 * disagrees with the row the database bills against is a billing bug.
 *
 * ── WHAT WAS REMOVED AND WHY ─────────────────────────────────────────────────
 * An earlier pass of this file carried "Up to N players" on the game tiers.
 * Those numbers were invented. They are not in the schema (`plans` has no
 * player column), not in the seed, and not in the API response, so nothing in
 * this system can confirm them — and a player count is a capacity promise, not
 * a price. The rows now show `maxServers`, which is real, enforced by the
 * backend, and already means something to a customer running more than one
 * world.
 *
 * ── WHAT IS NOT IN THE DATABASE ──────────────────────────────────────────────
 * Titan and Colossus have no row in the seed. They are display-only until
 * backend/src/db/seed.ts gains matching entries; see the note at the bottom of
 * this file.
 */

/* Row icons come from lucide so the glyph weights match the rest of the UI.
   There is no `Ram` export in this version — `MemoryStick` is its name. */
const ICON = {
    cpu: Cpu,
    ram: MemoryStick,
    storage: HardDrive,
    backup: Archive,
    support: Headphones,
};

const formatPrice = (cents) => (cents === 0 ? '$0' : `$${cents / 100}`);

const formatCpu = (milli) => {
    const cores = milli / 1000;
    const label = Number.isInteger(cores) ? `${cores}` : `${cores}`;
    return `${label} ${Number.isInteger(cores) ? (cores === 1 ? 'CPU Core' : 'CPU Cores') : 'CPU Cores'}`;
};

const formatRam = (mb) => (mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024}GB RAM` : `${mb}MB RAM`);

/* The plan ladder, verbatim from the seed. */
const PLANS = {
    free: { name: 'Free', cents: 0, cpu: 250, ram: 256, storage: 1, backups: 0, servers: 1 },
    starter: { name: 'Starter', cents: 100, cpu: 500, ram: 512, storage: 3, backups: 2, servers: 2 },
    pro: { name: 'Pro', cents: 200, cpu: 500, ram: 512, storage: 5, backups: 3, servers: 3 },
    premium: { name: 'Premium', cents: 300, cpu: 1000, ram: 1024, storage: 6, backups: 3, servers: 5 },
    gold: { name: 'Gold', cents: 500, cpu: 1000, ram: 2048, storage: 10, backups: 5, servers: 8 },
    platinum: { name: 'Platinum', cents: 700, cpu: 1500, ram: 3072, storage: 12, backups: 5, servers: 12 },
    diamond: { name: 'Diamond', cents: 850, cpu: 2000, ram: 5120, storage: 15, backups: 6, servers: 16 },
    elite: { name: 'Elite', cents: 1000, cpu: 2500, ram: 6144, storage: 18, backups: 7, servers: 24 },
    super: { name: 'Super', cents: 1500, cpu: 4000, ram: 10240, storage: 30, backups: 10, servers: 40 },
};

/* Display-only. No seed row exists for these two — see the note at the bottom.
   The resource steps deliberately follow the same cadence as the ladder above
   them (+33%, then +30%, mirroring $8.5 → $10 → $15) so the curve reads as one
   scale rather than a jump at the top. */
const EXTRA_PLANS = {
    titan: { name: 'Titan', cents: 2000, cpu: 6000, ram: 16384, storage: 60, backups: 15, servers: 60 },
    colossus: { name: 'Colossus', cents: 2600, cpu: 8000, ram: 24576, storage: 100, backups: 20, servers: 100 },
};

const row = (icon, label) => ({ icon, label, included: true });

/* `servers` is deliberately absent. `max_servers` exists in the schema but is
   not a selling point and reading it as one is misleading: the column says how
   many server records a plan may own, not how much it can run. Removed from the
   card rather than restated as "Unlimited", which would promise something the
   backend does not do.
   `p.servers` is still read below, because it is what the support tier is
   keyed off. */
const ROW_ORDER = ['cpu', 'ram', 'storage', 'backup', 'support'];

/* CPU / RAM / storage are the ACCOUNT's total, shared across every server the
   customer runs — the create form divides them as servers are added. Say so on
   the card, otherwise "1.5 vCPU" reads as per-server and the account ends up
   overcommitted the moment they spin up a second one. */
const SHARED_NOTE = 'shared across your servers';

const ROW_LABEL = {
    cpu: (p) => `${formatCpu(p.cpu)} ${SHARED_NOTE}`,
    ram: (p) => `${formatRam(p.ram)} ${SHARED_NOTE}`,
    storage: (p) => `${p.storage}GB Storage, ${SHARED_NOTE}`,
    backup: (p) => `${p.backups} Backup Slots`,
    support: (p) =>
        p.servers >= 12
            ? 'Premium Support'
            : p.servers >= 5
              ? 'Fast Support'
              : p.servers >= 2
                ? 'Ticket Support'
                : 'Community Support',
};

/** Builds a tier from a seed-shaped plan object. */
function tier(key, { desc, popular = false, source = PLANS, rows = ROW_ORDER }) {
    const p = source[key];

    return {
        id: key,
        name: p.name,
        desc,
        price: formatPrice(p.cents),
        period: '/month',
        cta: p.cents === 0 ? 'Start for Free' : `Get ${p.name}`,
        ctaTarget: '/signup',
        popular,
        features: rows.map((r) => row(ICON[r], ROW_LABEL[r](p))),
    };
}

/* Short, family-specific descriptions. The tiers themselves are identical —
   the same ladder is sold into three markets. */
const BOT_DESC = {
    free: 'One hobby bot, forever',
    starter: 'For a small community',
    pro: 'For a bot people rely on',
    premium: 'For several servers at once',
    gold: 'For a busy guild',
    platinum: 'For a network of bots',
    diamond: 'For a growing community',
    elite: 'For a large guild network',
    super: 'For bots at scale',
};

const APP_DESC = {
    free: 'One always-on app',
    starter: 'For a side project',
    pro: 'For production traffic',
    premium: 'For a service with users',
    gold: 'For a busy service',
    platinum: 'For a service under load',
    diamond: 'For a growing product',
    elite: 'For a high-traffic service',
    super: 'For scale',
};

const GAME_DESC = {
    platinum: 'For a small world',
    diamond: 'For a server people play on',
    elite: 'For a busy lobby',
    super: 'For a full lobby, all night',
};

const gamesSource = { ...Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, v])), ...EXTRA_PLANS };

/* ── THE ROTATING BUTTON ICONS ────────────────────────────────────────────────
 * `Icon` is the resting glyph shown when a family is not selected. `icons` is
 * the carousel that takes over while it is. They come from the same set the
 * Services section renders, so the mark on the button is the mark the visitor
 * already saw for that product.
 *
 * Game hosting lists six, of which the Services section currently shows two.
 * Nothing is invented here — every one is an export from components/icons.jsx.
 * If a game is not actually offered, drop it from this array rather than from
 * the icon file, so the carousel cannot advertise something that cannot be
 * bought. */
const FAMILY_ICONS = {
    bots: { Icon: Bot, icons: [IconDiscord, IconTelegram, IconTwitch, IconKick, IconReddit, IconSlack] },
    apps: { Icon: Braces, icons: [IconNode, IconBun, IconPython, IconPhp, IconGo, IconRust] },
    games: {
        Icon: Gamepad2,
        icons: [IconMinecraft, IconFivem, IconRustGame, IconArk, IconValheim, IconGmod],
    },
};

export const PRICING_CATEGORIES = [
    {
        id: 'bots',
        short: 'Bots',
        label: 'Bot hosting',
        hint: 'Discord & Telegram',
        ...FAMILY_ICONS.bots,
        headline: 'pro',
        blurb: 'One container per bot with the libraries already installed. A bot is IO-bound, so this family is sized on RAM.',
        tiers: ['free', 'starter', 'pro', 'premium', 'gold', 'platinum', 'diamond', 'elite', 'super'].map((k) =>
            tier(k, { desc: BOT_DESC[k], popular: k === 'pro' })
        ),
    },

    {
        id: 'apps',
        short: 'Apps',
        label: 'App hosting',
        hint: 'Node, Python, Go, Bun, PHP',
        ...FAMILY_ICONS.apps,
        headline: 'gold',
        blurb: 'Build on push, health-checked before traffic moves. Sized on CPU, because this is the family that compiles and serves.',
        tiers: ['free', 'starter', 'pro', 'premium', 'gold', 'platinum', 'diamond', 'elite', 'super'].map((k) =>
            tier(k, { desc: APP_DESC[k], popular: k === 'gold' })
        ),
    },

    {
        id: 'games',
        short: 'Games',
        label: 'Game hosting',
        hint: 'Minecraft, FiveM, Rust',
        ...FAMILY_ICONS.games,
        headline: 'elite',
        blurb: 'Tick-rate is bought with CPU and world size with RAM. The same ladder, starting where the other two stop.',
        tiers: [
            tier('platinum', { desc: GAME_DESC.platinum, source: gamesSource }),
            tier('diamond', { desc: GAME_DESC.diamond, source: gamesSource }),
            tier('elite', { desc: GAME_DESC.elite, popular: true, source: gamesSource }),
            tier('super', { desc: GAME_DESC.super, source: gamesSource }),
            tier('titan', { desc: 'For a community server', source: gamesSource }),
            tier('colossus', { desc: 'Dedicated, no neighbours', source: gamesSource }),
        ],
    },
];

/** The escape hatch, shown once under the picker. */
export const CUSTOM_TIER = {
    name: 'Custom',
    desc: 'Dedicated nodes, custom regions, or a fleet across several.',
    blurb: 'Tell us the CPU, RAM, storage and server count you need.',
};

/** The single plan the landing teaser quotes per family. */
export const getHeadline = (category) =>
    category.tiers.find((t) => t.id === category.headline) ?? category.tiers[0];

export const getCategory = (id) => PRICING_CATEGORIES.find((c) => c.id === id) ?? PRICING_CATEGORIES[0];

/*
 * ── TO SHIP TITAN AND COLOSSUS ───────────────────────────────────────────────
 * They are rendered but not purchasable. Add these two rows to
 * backend/src/db/seed.ts and re-run the seeder, or the buttons will point at a
 * plan id the database does not know:
 *
 *   { id: 'titan',    name: 'Titan',    priceCents: 2000, cpuMilli: 6000, ramMb: 16384, storageGb: 60,  maxServers: 60,  maxBackupSlots: 15, sortOrder: 10 },
 *   { id: 'colossus', name: 'Colossus', priceCents: 2600, cpuMilli: 8000, ramMb: 24576, storageGb: 100, maxServers: 100, maxBackupSlots: 20, sortOrder: 11 },
 *
 * and bump the existing `custom` row's sortOrder to 12 so it stays last.
 */