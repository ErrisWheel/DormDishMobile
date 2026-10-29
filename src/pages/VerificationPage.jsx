import { useEffect, useState } from 'react';
import { ArrowLeft, BadgeCheck, MailCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/api.js';

// Email verification
export function VerificationPage({ token = '', user = null, onBack, onDone, onVerified }) {
    const [busy, setBusy] = useState(Boolean(token));
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [verified, setVerified] = useState(Boolean(Number(user?.email_verified)));

    useEffect(() => {
        let alive = true;
        if (!token) return undefined;
        setBusy(true);
        apiRequest(`/auth/verify?token=${encodeURIComponent(token)}`)
            .then(async (result) => {
                if (!alive) return;
                const verifiedUser = result?.user || null;
                const isVerified = result?.emailVerified === true || Number(verifiedUser?.email_verified) === 1;
                if (!isVerified) throw new Error('The server did not confirm that this account is verified. Please request a new link and try again.');
                setVerified(true);
                setMessage(result?.message || 'Your email is verified.');
                setError('');
                if (onVerified) await onVerified(verifiedUser);
            })
            .catch((requestError) => { if (alive) setError(requestError.message || 'Could not verify this email link.'); })
            .finally(() => { if (alive) setBusy(false); });
        return () => { alive = false; };
    }, [token]);

    useEffect(() => {
        if (Number(user?.email_verified)) {
            setVerified(true);
            setMessage('Your account email is verified.');
            setError('');
        }
    }, [user?.email_verified]);

    async function sendAgain() {
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const result = await apiRequest('/auth/verification/send', { method: 'POST' });
            if (result?.alreadyVerified) {
                setVerified(true);
                setMessage(result.message || 'Your email is already verified.');
                if (onVerified) await onVerified(null);
            } else {
                setMessage(result.message || 'Verification email sent.');
            }
        } catch (requestError) {
            setError(requestError.message || 'Could not send the verification email.');
        } finally {
            setBusy(false);
        }
    }

    const isAlreadyVerified = verified || Boolean(Number(user?.email_verified));

    return (
        <main className="verification-shell">
            <section className="verification-card">
                <div className="verification-icon">{error ? <MailCheck size={28} /> : isAlreadyVerified || (token && !busy) ? <BadgeCheck size={28} /> : <ShieldCheck size={28} />}</div>
                <span className="eyebrow">DORMDISH ACCOUNT SECURITY</span>
                <h1>{token ? (busy ? 'Verifying your email…' : error ? 'Verification link needs attention' : isAlreadyVerified ? 'Email verified' : 'Verification complete') : isAlreadyVerified ? 'Email already verified' : 'Verify your email address'}</h1>
                <p>{token ? (busy ? 'Checking the secure link from your email.' : error ? 'The link may have expired or already been used. Sign in and request a fresh verification email.' : 'Your email verification was saved. Return to DormDish and your account status will refresh automatically when the app is open.') : isAlreadyVerified ? 'Your account has a verified email address.' : `Send a secure verification link to ${user?.email || 'your account email'}. The link expires after 24 hours.`}</p>
                {message && <div className="verification-success" role="status"><BadgeCheck size={17} /> {message}</div>}
                {error && <div className="form-error" role="alert">{error}</div>}
                {!token && <button type="button" className="primary-button full-button" onClick={sendAgain} disabled={busy || isAlreadyVerified}><MailCheck size={16} /> {busy ? 'Sending…' : isAlreadyVerified ? 'Email already verified' : 'Send verification email'}</button>}
                {token && !busy && !error && <button type="button" className="primary-button full-button" onClick={() => onDone ? onDone(null) : (window.history.replaceState({}, '', window.location.pathname), window.location.reload())}>Continue to DormDish</button>}
                {!token && <button type="button" className="route-secondary-action verification-back" onClick={onBack}><ArrowLeft size={15} /> Back to profile</button>}
                {busy && !token && <p className="verification-subtle"><RefreshCw size={14} /> Sending can take a few seconds.</p>}
            </section>
        </main>
    );
}
