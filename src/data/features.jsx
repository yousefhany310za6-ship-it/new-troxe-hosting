import { IconZap, IconShield, IconBars, IconRefresh, IconBook, IconUsers } from '../components/icons.jsx';

/**
 * Feature copy for the public features page. Every line describes something the
 * platform actually does today: container provisioning, per-server network
 * hardening, encrypted environment variables, live metrics, console/logs/files,
 * auto-restart, and the support ticket system.
 *
 * Deliberately absent (not implemented): DDoS mitigation, Git push deploys,
 * zero-downtime redeploys, managed databases, health-check alerting, and any
 * promise about support reply times.
 */
export const FEATURES = [
    {
        Icon: IconZap,
        title: 'Fast provisioning',
        text: 'Pick a runtime, set the startup command and variables, and a container is created for you.',
        details:
            'Choose Node.js, Python, Bun or PHP with a pinned version, set your environment variables, and the platform pulls the image, starts the container and shows you its status.',
    },
    {
        Icon: IconShield,
        title: 'Isolation and hardening',
        text: 'One container, one network and one volume per server, with its own firewall rules.',
        details:
            'Each server runs in its own container with a dedicated network and volume, and the platform applies its own ruleset to that network when it is created. Environment variables are stored encrypted and shown masked.',
    },
    {
        Icon: IconBars,
        title: 'A dashboard that shows the truth',
        text: 'Live CPU, RAM and disk usage against your plan limits, with logs and files next to it.',
        details:
            'Metrics stream in while the server runs, the console shows stdout and stderr, and the file manager lets you edit and upload without leaving the browser.',
    },
    {
        Icon: IconRefresh,
        title: 'Auto-restart',
        text: 'If a process exits, the platform brings the container back on its own.',
        details:
            'Restart behaviour is part of the server definition, so a crash does not leave your project down until you notice it.',
    },
    {
        Icon: IconBook,
        title: 'Backups and history',
        text: 'Backup slots according to your plan, plus an activity trail for every action.',
        details:
            'Take a snapshot on demand or automatically, restore it to a server, and see who did what from the server activity log.',
    },
    {
        Icon: IconUsers,
        title: 'Support tickets',
        text: 'Talk to a specialist inside the dashboard, with the server attached to the ticket.',
        details:
            'Open a ticket about a server, chat in real time, and let the specialist see the status, logs and events of the server involved.',
    },
];
