/**
 * FAQ — answers only cover what the platform really does today. Shared by the
 * landing page and the public FAQ page so both say exactly the same thing.
 * (Open questions like refunds, overages and migrations are answered honestly
 * rather than with an invented policy.)
 */
export const QUESTIONS = [
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
        a: 'CPU, RAM, storage, how many servers you can run and how many backup slots you get. Prices are listed on the pricing page and come straight from the plan list.',
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
