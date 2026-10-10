import { IconZap, IconShield, IconBars, IconRefresh, IconBook, IconUsers } from '../components/icons.jsx';

export const FEATURES = [
    {
        Icon: IconZap,
        title: 'Instant Deployment',
        text: 'Your bot starts running in under 30 seconds from signup. No complexity, no waiting.',
        details:
            'Push your code through Git, a zip upload or the web editor and it is live before your coffee cools. Zero-downtime redeploys mean updates never kick your users offline.',
    },
    {
        Icon: IconShield,
        title: 'Advanced Security',
        text: 'DDoS protection, firewalls, and full data encryption. Your bot is in safe hands.',
        details:
            'Every server sits behind always-on DDoS mitigation, isolated containers and encrypted storage. Suspicious traffic is filtered at the edge, before it ever reaches your app.',
    },
    {
        Icon: IconBars,
        title: 'Smart Dashboard',
        text: 'Everything in front of you: performance monitoring, file management, error logs, and more.',
        details:
            'CPU, RAM and bandwidth graphs, a built-in file manager and terminal, plus searchable logs — manage the whole fleet without touching SSH unless you want to.',
    },
    {
        Icon: IconRefresh,
        title: 'Auto-Restart',
        text: 'If your bot stops, we restart it automatically without any intervention from you.',
        details:
            'Health checks watch every process around the clock. A crash, a freeze or a failed deploy triggers an instant restart and an alert in your dashboard.',
    },
    {
        Icon: IconBook,
        title: 'Built-in Databases',
        text: 'Support for MySQL, PostgreSQL, MongoDB, and Redis without any complex setup.',
        details:
            'Spin up a managed database in one click and connect with a single URL. Automated backups, scaling storage and zero maintenance windows included.',
    },
    {
        Icon: IconUsers,
        title: '24/7 Support',
        text: 'Our support team is available 24/7 to help you anytime. In English and Arabic.',
        details:
            'Real engineers on Discord and tickets, median first reply in minutes. From "why did my bot stop?" to architecture advice — just ask.',
    },
];
