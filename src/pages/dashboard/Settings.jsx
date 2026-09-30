import { useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { apiGet, apiPatch, apiPost } from '@/lib/api.js';
import { useAuth } from '@/context/AuthContext.jsx';

const inputClass =
    'w-full rounded-xl border border-hairline bg-white/10 px-5 py-3 text-[0.92rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:ring-2 focus:ring-ring/40 focus:outline-none';

function Section({ title, subtitle, children }) {
    return (
        <section className="rounded-xl border border-hairline bg-card p-6 sm:p-8">
            <h2 className="text-[1.1rem] font-bold">{title}</h2>
            {subtitle && <p className="mt-1 text-[0.88rem] text-ink-secondary">{subtitle}</p>}
            <div className="mt-6">{children}</div>
        </section>
    );
}

function Toggle({ checked, onChange, label, hint }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className="flex w-full items-center gap-4 py-3 text-left"
        >
            <span
                className={cn(
                    'relative h-6 w-11 shrink-0 rounded-full transition',
                    checked ? 'bg-white' : 'bg-white/15'
                )}
            >
                <span
                    className={cn(
                        'absolute top-0.5 size-5 rounded-full transition-all',
                        checked ? 'left-[22px] bg-black' : 'left-0.5 bg-white'
                    )}
                />
            </span>
            <span>
                <span className="block text-[0.92rem] font-semibold">{label}</span>
                {hint && <span className="block text-[0.82rem] text-ink-secondary">{hint}</span>}
            </span>
        </button>
    );
}

export default function Settings() {
    const { user, reloadUser } = useAuth();
    const [profile, setProfile] = useState({ name: '', email: '' });
    const [avatar, setAvatar] = useState(null);
    const fileRef = useRef(null);
    const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
    const [notif, setNotif] = useState({ restarts: true, invoices: true, marketing: false });
    const [msg, setMsg] = useState({ text: '', ok: true });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user) {
            setProfile({ name: user.name, email: user.email });
            setNotif({
                restarts: user.notifyRestarts ?? true,
                invoices: user.notifyInvoices ?? true,
                marketing: user.notifyMarketing ?? false,
            });
            setLoading(false);
        }
    }, [user]);

    const handleAvatar = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setMsg({ text: 'Please choose an image file.', ok: false });
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            setMsg({ text: 'Image must be smaller than 2MB.', ok: false });
            return;
        }
        if (avatar) URL.revokeObjectURL(avatar);
        setAvatar(URL.createObjectURL(file));
        setMsg({ text: 'Avatar updated locally. Save profile to persist.', ok: true });
    };

    const removeAvatar = () => {
        if (avatar) URL.revokeObjectURL(avatar);
        setAvatar(null);
        if (fileRef.current) fileRef.current.value = '';
        setMsg({ text: 'Avatar removed. Save profile to persist.', ok: true });
    };

    const saveProfile = async (e) => {
        e.preventDefault();
        if (!profile.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
            setMsg({ text: 'Please enter a valid name and email.', ok: false });
            return;
        }
        try {
            await apiPatch('/users/me', profile);
            setMsg({ text: 'Profile saved.', ok: true });
            reloadUser();
        } catch (err) {
            setMsg({ text: err.message, ok: false });
        }
    };

    const changePassword = async (e) => {
        e.preventDefault();
        if (!passwords.current || !passwords.next || !passwords.confirm) {
            setMsg({ text: 'Please fill in all password fields.', ok: false });
            return;
        }
        if (passwords.next.length < 8) {
            setMsg({ text: 'New password must be at least 8 characters.', ok: false });
            return;
        }
        if (passwords.next !== passwords.confirm) {
            setMsg({ text: 'New passwords do not match.', ok: false });
            return;
        }
        try {
            await apiPost('/users/me/password', passwords);
            setMsg({ text: 'Password changed. You will be logged out of other sessions.', ok: true });
            setPasswords({ current: '', next: '', confirm: '' });
            reloadUser();
        } catch (err) {
            setMsg({ text: err.message, ok: false });
        }
    };

    const saveNotifications = async () => {
        try {
            await apiPatch('/users/me/notifications', notif);
            setMsg({ text: 'Notifications updated.', ok: true });
            reloadUser();
        } catch (err) {
            setMsg({ text: err.message, ok: false });
        }
    };

    const deleteAccount = async () => {
        const password = window.prompt('This will DELETE your account and ALL servers permanently. Enter your password to confirm:');
        if (!password) {
            setMsg({ text: 'Deletion cancelled.', ok: false });
            return;
        }
        try {
            await apiPost('/users/me', { current: password });
            setMsg({ text: 'Account deleted.', ok: true });
            setTimeout(() => window.location.href = '/', 1500);
        } catch (err) {
            setMsg({ text: err.message, ok: false });
        }
    };

    if (loading) {
        return <div className="flex items-center justify-center h-64 text-ink-muted">Loading…</div>;
    }

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-[1.6rem] font-extrabold tracking-tight">Settings</h1>
                <p className="mt-1 text-[0.92rem] text-ink-secondary">
                    Manage your account and preferences.
                </p>
            </div>

            {msg.text && (
                <p className={cn('text-sm', msg.ok ? 'text-emerald-400' : 'text-red-400')}>
                    {msg.text}
                </p>
            )}

            <Section title="Profile" subtitle="How you appear across Troxe Host.">
                <div className="mb-6 flex items-center gap-4">
                    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-xl font-bold text-white">
                        {avatar ? (
                            <img src={avatar} alt="Profile photo" className="size-full object-cover" />
                        ) : (
                            (profile.name.charAt(0) || 'U').toUpperCase()
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            onChange={handleAvatar}
                            className="hidden"
                        />
                        <button
                            type="button"
                            onClick={() => fileRef.current?.click()}
                            className="rounded-full bg-white px-5 py-2 text-[0.83rem] font-bold text-black transition hover:bg-gray-200"
                        >
                            Change photo
                        </button>
                        {avatar && (
                            <button
                                type="button"
                                onClick={removeAvatar}
                                className="rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground"
                            >
                                Remove
                            </button>
                        )}
                    </div>
                </div>
                <form onSubmit={saveProfile} className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                    <label className="flex flex-col gap-1.5 text-[0.85rem] font-semibold">
                        Username
                        <input
                            value={profile.name}
                            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                            className={inputClass}
                        />
                    </label>
                    <label className="flex flex-col gap-1.5 text-[0.85rem] font-semibold">
                        Email
                        <input
                            type="email"
                            value={profile.email}
                            onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                            className={inputClass}
                        />
                    </label>
                    <div className="col-span-2 max-md:col-span-1">
                        <button
                            type="submit"
                            className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200"
                        >
                            Save changes
                        </button>
                    </div>
                </form>
            </Section>

            <Section title="Password" subtitle="Use at least 8 characters.">
                <form onSubmit={changePassword} className="grid grid-cols-1 gap-4">
                    <input
                        type="password"
                        placeholder="Current password"
                        autoComplete="current-password"
                        value={passwords.current}
                        onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                        className={inputClass}
                    />
                    <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                        <input
                            type="password"
                            placeholder="New password"
                            autoComplete="new-password"
                            value={passwords.next}
                            onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
                            className={inputClass}
                        />
                        <input
                            type="password"
                            placeholder="Confirm new password"
                            autoComplete="new-password"
                            value={passwords.confirm}
                            onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <button
                            type="submit"
                            className="rounded-full border border-hairline bg-transparent px-6 py-2.5 text-sm font-bold text-foreground transition hover:border-primary hover:bg-primary hover:text-primary-foreground"
                        >
                            Update password
                        </button>
                    </div>
                </form>
            </Section>

            <Section title="Notifications" subtitle="Choose what lands in your inbox.">
                <div className="flex flex-col divide-y divide-hairline">
                    <Toggle
                        checked={notif.restarts}
                        onChange={(v) => { setNotif({ ...notif, restarts: v }); saveNotifications(); }}
                        label="Restarts & incidents"
                        hint="When a server goes down or recovers."
                    />
                    <Toggle
                        checked={notif.invoices}
                        onChange={(v) => { setNotif({ ...notif, invoices: v }); saveNotifications(); }}
                        label="Billing & invoices"
                        hint="Receipts, renewals and failed payments."
                    />
                    <Toggle
                        checked={notif.marketing}
                        onChange={(v) => { setNotif({ ...notif, marketing: v }); saveNotifications(); }}
                        label="Product news"
                        hint="New runtimes, features and offers."
                    />
                </div>
            </Section>

            <section className="rounded-xl border border-red-500/30 bg-card p-6 sm:p-8">
                <h2 className="text-[1.1rem] font-bold text-red-400">Danger zone</h2>
                <p className="mt-1 text-[0.88rem] text-ink-secondary">
                    Deleting your account stops all servers immediately. This cannot be undone.
                </p>
                <button
                    type="button"
                    onClick={deleteAccount}
                    className="mt-5 rounded-full border border-red-500/40 px-6 py-2.5 text-sm font-bold text-red-400 transition hover:bg-red-500 hover:text-white"
                >
                    Delete account
                </button>
            </section>
        </div>
    );
}