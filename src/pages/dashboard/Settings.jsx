import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BadgeCheck, CalendarClock, Camera, Loader2, ShieldCheck, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiDelete, apiPatch } from '@/lib/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import {
    useChangePassword,
    useOAuthLinkConfirm,
    useOAuthLinkStart,
    useOAuthStatus,
    useOAuthUnlink,
    useRemoveAvatar,
    useSetPassword,
    useUpdateProfile,
    useUploadAvatar,
} from '@/hooks/useQueries.jsx';
import { useToast } from '@/hooks/useToast.jsx';
import { Modal } from '@/components/ui/modal.jsx';
import { ConfirmModal } from '@/components/ui/confirm-modal.jsx';
import { Field, Input, PasswordInput, Skeleton } from '@/components/ui/field.jsx';
import { PasswordStrength } from '@/components/ui/password-strength.jsx';
import { AvatarCropModal } from '@/components/AvatarCropModal.jsx';
import { TwoFactorSetup } from '@/components/TwoFactorSetup.jsx';
import { TwoFactorChallenge } from '@/components/TwoFactorChallenge.jsx';
import { AvatarBadge } from '@/components/AvatarBadge.jsx';

const USERNAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_RULES = [
    { id: 'length', label: '8 characters or more', test: (v) => v.length >= 8 },
    { id: 'letter', label: 'A letter', test: (v) => /[A-Za-z]/.test(v) },
    { id: 'digit', label: 'A number', test: (v) => /\d/.test(v) },
];
const NAME_RE = /^[\p{L}\p{N}._-]+(?: [\p{L}\p{N}._-]+)*$/u;

function Section({ title, subtitle, children, danger = false }) {
    return (
        <section className={cn('rounded-xl border bg-card p-6 sm:p-8', danger ? 'border-red-500/30' : 'border-hairline')}>
            <h2 className={cn('text-[1.1rem] font-bold', danger && 'text-red-400')}>{title}</h2>
            {subtitle && <p className="mt-1 text-[0.88rem] text-ink-secondary">{subtitle}</p>}
            <div className="mt-6">{children}</div>
        </section>
    );
}

function Toggle({ checked, onChange, label, hint, busy }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={busy}
            onClick={() => onChange(!checked)}
            className="flex w-full items-center gap-4 py-3 text-left disabled:opacity-60"
        >
            <span className={cn('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-white' : 'bg-white/15')}>
                <span className={cn('absolute top-0.5 size-5 rounded-full transition-all', checked ? 'left-[22px] bg-black' : 'left-0.5 bg-white')} />
            </span>
            <span>
                <span className="block text-[0.92rem] font-semibold">{label}</span>
                {hint && <span className="block text-[0.82rem] text-ink-secondary">{hint}</span>}
            </span>
            {busy && <Loader2 size={14} className="ml-auto animate-spin text-ink-muted" />}
        </button>
    );
}

export default function Settings() {
    const { user, reloadUser, signOut } = useAuth();
    const navigate = useNavigate();
    const toast = useToast();
    const [searchParams, setSearchParams] = useSearchParams();

    const updateProfile = useUpdateProfile();
    const uploadAvatar = useUploadAvatar();
    const removeAvatar = useRemoveAvatar();
    const changePassword = useChangePassword();
    const oauth = useOAuthStatus();
    const linkStart = useOAuthLinkStart();
    const linkConfirm = useOAuthLinkConfirm();
    const unlinkOAuth = useOAuthUnlink();

    // ---- 2FA ------------------------------------------------------------------
    const [twoFactor, setTwoFactor] = useState(null);
    const [twoFactorSetup, setTwoFactorSetup] = useState(null);
    const [twoFactorDisable, setTwoFactorDisable] = useState(false);
    const [twoFactorDisableCode, setTwoFactorDisableCode] = useState('');
    const [twoFactorBusy, setTwoFactorBusy] = useState(false);
    const [twoFactorError, setTwoFactorError] = useState(null);

    const fetchTwoFactor = useCallback(async () => {
        try {
            const res = await apiGet('/auth/2fa');
            setTwoFactor(res);
        } catch {
            setTwoFactor({ enabled: false, unusedRecoveryCodes: 0 });
        }
    }, []);

    useEffect(() => { fetchTwoFactor(); }, [fetchTwoFactor]);

    const startTwoFactorSetup = async () => {
        setTwoFactorBusy(true);
        setTwoFactorError(null);
        try {
            const res = await apiPost('/auth/2fa/setup', {});
            setTwoFactorSetup(res);
        } catch (err) {
            setTwoFactorError(err.message);
        } finally {
            setTwoFactorBusy(false);
        }
    };

    const confirmTwoFactorSetup = async (code) => {
        setTwoFactorBusy(true);
        try {
            const res = await apiPost('/auth/2fa/confirm', { code });
            setTwoFactorSetup(null);
            setTwoFactor({ enabled: true, unusedRecoveryCodes: res.recoveryCodes.length });
            fetchTwoFactor();
            return res;
        } finally {
            setTwoFactorBusy(false);
        }
    };

    const disableTwoFactor = async () => {
        if (!twoFactorDisableCode) return;
        setTwoFactorBusy(true);
        setTwoFactorError(null);
        try {
            await apiPost('/auth/2fa/disable', { code: twoFactorDisableCode });
            setTwoFactorDisable(false);
            setTwoFactorDisableCode('');
            setTwoFactor({ enabled: false, unusedRecoveryCodes: 0 });
            toast.success('Two-factor authentication disabled.');
        } catch (err) {
            setTwoFactorError(err.message);
        } finally {
            setTwoFactorBusy(false);
        }
    };

    const regenerateRecoveryCodes = async () => {
        setTwoFactorBusy(true);
        setTwoFactorError(null);
        try {
            const res = await apiPost('/auth/2fa/recovery-codes', { code: twoFactorDisableCode });
            setTwoFactorDisableCode('');
            setTwoFactor({ ...twoFactor, unusedRecoveryCodes: res.recoveryCodes.length });
            return res;
        } catch (err) {
            setTwoFactorError(err.message);
            throw err;
        } finally {
            setTwoFactorBusy(false);
        }
    };
    const setPassword = useSetPassword();

    const fileRef = useRef(null);
    const [cropFile, setCropFile] = useState(null);
    const [nameModal, setNameModal] = useState(false);
    const [nameValue, setNameValue] = useState('');
    const [nameError, setNameError] = useState(null);
    const [unlinkTarget, setUnlinkTarget] = useState(null);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deletePw, setDeletePw] = useState('');
    const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
    const [pwErrors, setPwErrors] = useState({});
    const [newPw, setNewPw] = useState({ next: '', confirm: '' });
    const [notifBusy, setNotifBusy] = useState(null);

    // Returning from a provider link flow (?oauth_link=…&provider=…)
    useEffect(() => {
        const token = searchParams.get('oauth_link');
        const provider = searchParams.get('provider');
        if (!token || !provider) return;
        (async () => {
            try {
                await linkConfirm.mutateAsync(token);
                toast.success(`${provider} account linked.`);
            } catch (err) {
                toast.error(err.message);
            } finally {
                setSearchParams({}, { replace: true });
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- username cooldown (backend is the source of truth; this is UX) ----
    const nextNameChangeAt = useMemo(() => {
        if (!user?.usernameChangedAt) return null;
        const t = new Date(user.usernameChangedAt).getTime() + USERNAME_COOLDOWN_MS;
        return t > Date.now() ? new Date(t) : null;
    }, [user?.usernameChangedAt]);

    const daysLeft = nextNameChangeAt
        ? Math.max(1, Math.ceil((nextNameChangeAt.getTime() - Date.now()) / 86400000))
        : 0;

    // ---- avatar ------------------------------------------------------------
    const onPickAvatar = (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            toast.error('Only JPEG, PNG and WebP images are allowed.');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            toast.error('Image must be smaller than 5 MB.');
            return;
        }
        setCropFile(file);
    };

    const saveAvatar = async (blob) => {
        try {
            await uploadAvatar.mutateAsync(blob);
            setCropFile(null);
            toast.success('Avatar updated.');
            reloadUser();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const doRemoveAvatar = async () => {
        try {
            await removeAvatar.mutateAsync();
            toast.success('Avatar removed.');
            reloadUser();
        } catch (err) {
            toast.error(err.message);
        }
    };

    // ---- username ------------------------------------------------------------
    const openNameModal = () => {
        setNameValue(user?.name ?? '');
        setNameError(null);
        setNameModal(true);
    };

    const saveName = async () => {
        const name = nameValue.trim();
        if (name.length < 3 || name.length > 30) return setNameError('Username must be 3–30 characters.');
        if (!NAME_RE.test(name)) return setNameError('Only letters, numbers, spaces, dots, dashes and underscores.');
        try {
            await updateProfile.mutateAsync({ name });
            setNameModal(false);
            toast.success('Username updated.');
            reloadUser();
        } catch (err) {
            if (err.code === 'NAME_CHANGE_TOO_SOON' && err.nextChangeAt) {
                setNameError(`You can change it again on ${new Date(err.nextChangeAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}.`);
            } else {
                setNameError(err.message);
            }
        }
    };

    // ---- password ------------------------------------------------------------
    const submitPassword = async (e) => {
        e.preventDefault();
        const errs = {};
        if (!passwords.current) errs.current = 'Enter your current password.';
        if (passwords.next.length < 8) errs.next = 'At least 8 characters.';
        else if (!/[A-Za-z]/.test(passwords.next) || !/\d/.test(passwords.next)) errs.next = 'Needs a letter and a number.';
        if (passwords.confirm !== passwords.next) errs.confirm = 'Passwords do not match.';
        setPwErrors(errs);
        if (Object.keys(errs).length) return;
        try {
            const res = await changePassword.mutateAsync(passwords);
            toast.success(`Password changed. ${res?.revokedSessions ? 'All sessions were signed out.' : 'Please sign in again.'}`);
            await signOut();
            navigate('/signin', { replace: true });
        } catch (err) {
            setPwErrors(err.code === 'WRONG_CURRENT_PASSWORD' || /current/i.test(err.message)
                ? { current: 'Current password is incorrect.' }
                : { form: err.message });
        }
    };

    // ---- notifications ---------------------------------------------------------
    const saveNotif = async (key, value) => {
        setNotifBusy(key);
        try {
            await apiPatch('/users/me/notifications', { [key]: value });
            toast.success('Preference saved.');
            reloadUser();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setNotifBusy(null);
        }
    };

    // ---- oauth -----------------------------------------------------------------
    const startLink = async (provider) => {
        try {
            const { url } = await linkStart.mutateAsync(provider);
            window.location.assign(url);
        } catch (err) {
            toast.error(err.message);
        }
    };

    const doSetPassword = async (e) => {
        e.preventDefault();
        try {
            const res = await setPassword.mutateAsync(newPw);
            toast.success(`Password set. ${res?.revokedSessions ? 'All sessions were signed out — please sign in again.' : 'You can now sign in with email + password too.'}`);
            setNewPw({ next: '', confirm: '' });
            if (res?.revokedSessions) {
                await signOut();
                navigate('/signin', { replace: true });
            } else {
                oauth.refetch();
            }
        } catch (err) {
            toast.error(err.message);
        }
    };

    // ---- delete account ----------------------------------------------------------
    const doDeleteAccount = async () => {
        await apiDelete('/users/me', { body: { current: deletePw } });
        toast.success('Account deleted.');
        setTimeout(() => { window.location.href = '/'; }, 800);
    };

    if (!user) {
        return (
            <div className="flex flex-col gap-6">
                <Skeleton className="h-9 w-48" />
                <Skeleton className="h-64 w-full rounded-xl" />
                <Skeleton className="h-48 w-full rounded-xl" />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-[1.6rem] font-extrabold tracking-tight">Settings</h1>
                <p className="mt-1 text-[0.92rem] text-ink-secondary">Manage your account and preferences.</p>
            </div>

            {/* ============================== Profile ============================== */}
            <Section title="Profile" subtitle="How you appear across Troxe Host.">
                <div className="flex flex-wrap items-center gap-4">
                    <AvatarBadge url={user.avatarUrl} name={user.name} />
                    <div className="flex flex-wrap items-center gap-2">
                        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={onPickAvatar} className="hidden" />
                        <button
                            type="button"
                            onClick={() => fileRef.current?.click()}
                            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-[0.83rem] font-bold text-black transition hover:bg-gray-200"
                        >
                            <Camera size={14} />
                            Change avatar
                        </button>
                        {user.avatarSource === 'custom' && (
                            <button
                                type="button"
                                onClick={doRemoveAvatar}
                                disabled={removeAvatar.isPending}
                                className="inline-flex items-center gap-2 rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:opacity-60"
                            >
                                {removeAvatar.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                Remove
                            </button>
                        )}
                    </div>
                    <p className="w-full text-[0.8rem] text-ink-muted">
                        JPEG, PNG or WebP, up to 5 MB — resized to 256×256.
                        {user.avatarSource === 'oauth' && ' Currently using your provider picture: uploading your own stops it from syncing.'}
                    </p>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4 max-md:grid-cols-1">
                    <div>
                        <span className="mb-1.5 block text-[0.82rem] font-medium text-ink-secondary">Username</span>
                        <div className="flex items-center gap-2">
                            <Input value={user.name} readOnly disabled className="font-mono" />
                            <button
                                type="button"
                                onClick={openNameModal}
                                disabled={!!nextNameChangeAt}
                                className="shrink-0 rounded-full border border-hairline px-4 py-2 text-[0.8rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Change
                            </button>
                        </div>
                        {nextNameChangeAt && (
                            <p className="mt-1.5 flex items-center gap-1.5 text-[0.78rem] text-ink-muted">
                                <CalendarClock size={13} />
                                Username can be changed again in {daysLeft} day{daysLeft === 1 ? '' : 's'} — {nextNameChangeAt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                            </p>
                        )}
                    </div>
                    <div>
                        <span className="mb-1.5 block text-[0.82rem] font-medium text-ink-secondary">Email</span>
                        <div className="flex items-center gap-2">
                            <Input value={user.email} readOnly disabled className="font-mono" />
                            {user.emailVerified ? (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[0.72rem] font-bold text-emerald-400">
                                    <BadgeCheck size={13} /> Verified
                                </span>
                            ) : (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[0.72rem] font-bold text-amber-400">
                                    Unverified
                                </span>
                            )}
                        </div>
                        <p className="mt-1.5 text-[0.78rem] text-ink-muted">Your email is permanent — it's the identity of the account.</p>
                    </div>
                </div>
            </Section>

            {/* ============================== Password ============================== */}
            <Section title="Password" subtitle="Changing it signs out every session, including this one.">
                <form onSubmit={submitPassword} className="grid grid-cols-1 gap-4" noValidate>
                    <Field label="Current password" error={pwErrors.current}>
                        <PasswordInput
                            autoComplete="current-password"
                            value={passwords.current}
                            invalid={!!pwErrors.current}
                            onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                        />
                    </Field>
                    <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                        <Field label="New password" error={pwErrors.next}>
                            <PasswordInput
                                autoComplete="new-password"
                                value={passwords.next}
                                invalid={!!pwErrors.next}
                                onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
                            />
                        </Field>
                        <Field label="Confirm new password" error={pwErrors.confirm}>
                            <PasswordInput
                                autoComplete="new-password"
                                value={passwords.confirm}
                                invalid={!!pwErrors.confirm}
                                onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                            />
                        </Field>
                    </div>
                    <PasswordStrength value={passwords.next} rules={PASSWORD_RULES} />
                    {pwErrors.form && <p className="text-[0.82rem] text-red-400" role="alert">{pwErrors.form}</p>}
                    <div>
                        <button
                            type="submit"
                            disabled={changePassword.isPending}
                            className="inline-flex items-center gap-2 rounded-full border border-hairline bg-transparent px-6 py-2.5 text-sm font-bold text-foreground transition hover:border-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-60"
                        >
                            {changePassword.isPending && <Loader2 size={14} className="animate-spin" />}
                            Update password
                        </button>
                    </div>
                </form>
            </Section>

            {/* ============================== Security ============================== */}
            <Section title="Security" subtitle="Protect your account with two-factor authentication.">
                <div className="flex flex-col gap-4">
                    {/* 2FA Status */}
                    <div className="flex items-center justify-between rounded-xl border border-hairline bg-black/20 p-4">
                        <div className="flex items-center gap-3">
                            <div className={`flex size-10 items-center justify-center rounded-full ${twoFactor?.enabled ? 'bg-emerald-500/10' : 'bg-white/5'}`}>
                                <ShieldCheck className={`size-5 ${twoFactor?.enabled ? 'text-emerald-400' : 'text-ink-muted'}`} />
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-foreground">Two-factor authentication</p>
                                <p className="text-xs text-ink-muted">
                                    {twoFactor?.enabled
                                        ? `Enabled — ${twoFactor?.unusedRecoveryCodes ?? 0} recovery codes remaining`
                                        : 'Disabled — add an extra layer of security'}
                                </p>
                            </div>
                        </div>
                        {!twoFactor?.enabled && !twoFactorSetup && (
                            <button
                                type="button"
                                onClick={startTwoFactorSetup}
                                disabled={twoFactorBusy}
                                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold text-black transition hover:bg-gray-200 disabled:opacity-50"
                            >
                                {twoFactorBusy ? <Loader2 className="size-3 animate-spin" /> : <ShieldCheck className="size-3" />}
                                Enable 2FA
                            </button>
                        )}
                    </div>

                    {/* 2FA Setup Flow */}
                    {twoFactorSetup && (
                        <div className="rounded-xl border border-hairline bg-black/20 p-4">
                            <TwoFactorSetup
                                setupData={twoFactorSetup}
                                onConfirm={confirmTwoFactorSetup}
                                onCancel={() => setTwoFactorSetup(null)}
                                busy={twoFactorBusy}
                            />
                        </div>
                    )}

                    {/* 2FA Disable */}
                    {twoFactor?.enabled && !twoFactorSetup && (
                        <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-black/20 p-4">
                            <div className="flex items-center justify-between">
                                <p className="text-xs text-ink-muted">Disable 2FA or regenerate recovery codes.</p>
                                <button
                                    type="button"
                                    onClick={() => setTwoFactorDisable(!twoFactorDisable)}
                                    className="text-xs font-bold text-ink-secondary underline-offset-4 transition hover:text-foreground hover:underline"
                                >
                                    {twoFactorDisable ? 'Cancel' : 'Manage'}
                                </button>
                            </div>
                            {twoFactorDisable && (
                                <div className="flex flex-col gap-3">
                                    <Field label="Enter 6-digit code or recovery code">
                                        <Input
                                            value={twoFactorDisableCode}
                                            onChange={(e) => setTwoFactorDisableCode(e.target.value)}
                                            placeholder="000000"
                                            className="font-mono"
                                        />
                                    </Field>
                                    {twoFactorError && <p className="text-xs text-red-400">{twoFactorError}</p>}
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={disableTwoFactor}
                                            disabled={twoFactorBusy || !twoFactorDisableCode}
                                            className="inline-flex flex-1 items-center justify-center rounded-full border border-red-500/30 px-4 py-2 text-xs font-bold text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
                                        >
                                            {twoFactorBusy ? <Loader2 className="size-3 animate-spin" /> : 'Disable 2FA'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={regenerateRecoveryCodes}
                                            disabled={twoFactorBusy || !twoFactorDisableCode}
                                            className="inline-flex flex-1 items-center justify-center rounded-full border border-hairline px-4 py-2 text-xs font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:opacity-50"
                                        >
                                            Regenerate codes
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </Section>

            {/* ============================== Sign-in methods ============================== */}
            <Section title="Sign-in methods" subtitle="Google and Discord live next to your password. Linking never merges accounts by email alone.">
                {oauth.isLoading ? (
                    <div className="flex flex-col gap-3">
                        <Skeleton className="h-16 w-full rounded-xl" />
                        <Skeleton className="h-16 w-full rounded-xl" />
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {['google', 'discord'].map((p) => {
                            const row = (oauth.data?.providers || []).find((r) => r.provider === p);
                            const label = p === 'google' ? 'Google' : 'Discord';
                            return (
                                <div key={p} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline px-4 py-3">
                                    <div>
                                        <p className="text-[0.92rem] font-semibold capitalize">{label}</p>
                                        <p className="text-[0.8rem] text-ink-muted">
                                            {row
                                                ? `Linked${row.email ? ` as ${row.email}` : ''}${p === 'discord' ? (row.guildJoined ? ' · in our Discord server' : ' · not in our server yet') : ''}`
                                                : 'Not linked'}
                                        </p>
                                    </div>
                                    {row ? (
                                        <button
                                            type="button"
                                            onClick={() => setUnlinkTarget(p)}
                                            className="rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground"
                                        >
                                            Unlink
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => startLink(p)}
                                            disabled={linkStart.isPending}
                                            className="rounded-full bg-white px-5 py-2 text-[0.83rem] font-bold text-black transition hover:bg-gray-200 disabled:opacity-60"
                                        >
                                            Link {label}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
                {oauth.data && !oauth.data.hasPassword && (
                    <form onSubmit={doSetPassword} className="mt-5 grid grid-cols-2 gap-4 max-md:grid-cols-1">
                        <p className="col-span-2 text-[0.85rem] text-ink-secondary max-md:col-span-1">
                            You signed up with a provider and have no password yet — set one to enable email + password sign-in.
                        </p>
                        <Field error={newPw.next && newPw.next.length < 8 ? 'At least 8 characters.' : null}>
                            <PasswordInput
                                placeholder="New password"
                                autoComplete="new-password"
                                value={newPw.next}
                                onChange={(e) => setNewPw({ ...newPw, next: e.target.value })}
                            />
                        </Field>
                        <Field error={newPw.confirm && newPw.confirm !== newPw.next ? 'Passwords do not match.' : null}>
                            <PasswordInput
                                placeholder="Confirm new password"
                                autoComplete="new-password"
                                value={newPw.confirm}
                                onChange={(e) => setNewPw({ ...newPw, confirm: e.target.value })}
                            />
                        </Field>
                        <div className="col-span-2 max-md:col-span-1">
                            <button
                                type="submit"
                                disabled={setPassword.isPending || newPw.next.length < 8 || newPw.next !== newPw.confirm}
                                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-gray-200 disabled:opacity-60"
                            >
                                {setPassword.isPending && <Loader2 size={14} className="animate-spin" />}
                                Set password
                            </button>
                        </div>
                    </form>
                )}
            </Section>

            {/* ============================== Notifications ============================== */}
            <Section title="Notifications" subtitle="Choose what lands in your inbox.">
                <div className="flex flex-col divide-y divide-hairline">
                    <Toggle
                        checked={user.notifyRestarts ?? true}
                        busy={notifBusy === 'restarts'}
                        onChange={(v) => saveNotif('restarts', v)}
                        label="Restarts & incidents"
                        hint="When a server goes down or recovers."
                    />
                    <Toggle
                        checked={user.notifyInvoices ?? true}
                        busy={notifBusy === 'invoices'}
                        onChange={(v) => saveNotif('invoices', v)}
                        label="Billing & invoices"
                        hint="Receipts, renewals and failed payments."
                    />
                    <Toggle
                        checked={user.notifyMarketing ?? false}
                        busy={notifBusy === 'marketing'}
                        onChange={(v) => saveNotif('marketing', v)}
                        label="Product news"
                        hint="New runtimes, features and offers."
                    />
                </div>
            </Section>

            {/* ============================== Danger zone ============================== */}
            <Section danger title="Danger zone" subtitle="Deleting your account stops all servers immediately. This cannot be undone.">
                <button
                    type="button"
                    onClick={() => { setDeletePw(''); setDeleteOpen(true); }}
                    className="rounded-full border border-red-500/40 px-6 py-2.5 text-sm font-bold text-red-400 transition hover:bg-red-500 hover:text-white"
                >
                    Delete account
                </button>
            </Section>

            {/* ============================== Modals ============================== */}
            <AvatarCropModal
                open={!!cropFile}
                file={cropFile}
                onClose={() => setCropFile(null)}
                onSave={saveAvatar}
                busy={uploadAvatar.isPending}
            />

            <Modal
                open={nameModal}
                onClose={() => setNameModal(false)}
                title="Change username"
                description="You can change your username once every 30 days."
                footer={
                    <>
                        <button type="button" onClick={() => setNameModal(false)} className="btn-ghost-modal">Cancel</button>
                        <button type="button" onClick={saveName} disabled={updateProfile.isPending || nameValue.trim() === user.name} className="btn-primary-modal">
                            {updateProfile.isPending && <Loader2 size={15} className="animate-spin" />}
                            Save username
                        </button>
                    </>
                }
            >
                <Field label="New username" error={nameError} hint="3–30 characters: letters, numbers, spaces, dots, dashes, underscores.">
                    <Input
                        value={nameValue}
                        invalid={!!nameError}
                        onChange={(e) => { setNameValue(e.target.value); setNameError(null); }}
                        maxLength={30}
                        autoComplete="off"
                    />
                </Field>
            </Modal>

            <ConfirmModal
                open={!!unlinkTarget}
                onClose={() => setUnlinkTarget(null)}
                title={`Unlink ${unlinkTarget === 'google' ? 'Google' : 'Discord'}?`}
                description="You'll no longer be able to sign in with this provider. Your account and servers stay untouched."
                confirmLabel="Unlink"
                onConfirm={async () => {
                    await unlinkOAuth.mutateAsync(unlinkTarget);
                    toast.success('Provider unlinked.');
                }}
            />

            <ConfirmModal
                open={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title="Delete your account?"
                description="This permanently deletes your account, ALL servers, files and backups. There is no way back."
                confirmLabel="Delete everything"
                confirmDisabled={!deletePw}
                onConfirm={doDeleteAccount}
            >
                <Field label="Confirm with your password">
                    <PasswordInput
                        value={deletePw}
                        autoComplete="current-password"
                        onChange={(e) => setDeletePw(e.target.value)}
                    />
                </Field>
            </ConfirmModal>
        </div>
    );
}
