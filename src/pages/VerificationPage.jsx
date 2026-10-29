import { useEffect, useState } from 'react';
import { ArrowLeft, BadgeCheck, MailCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/api.js';

export function VerificationPage({ token = '', user = null, onBack, onDone }) {
    const [busy, setBusy] = useState(Boolean(token));
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        let alive = true;
        if (!token) return undefined;
        apiRequest(`/auth/verify?token=${encodeURIComponent(token)}`)
            .then((result) => { if (alive) { setMessage(result.message || 'Your email is verified.'); setError(''); } })
            .catch((requestError) => { if (alive) setError(requestError.message); })
            .finally(() => { if (alive) setBusy(false); });
        return () => { alive = false; };
    }, [token]);

    async function sendAgain() {
        setBusy(true); setError(''); setMessage('');
        try { const result = await apiRequest('/auth/verification/send', { method: 'POST' }); setMessage(result.message || 'Verification email sent.'); }
        catch (requestError) { setError(requestError.message); }
        finally { setBusy(false); }
    }

    return (
        <main className="verification-shell">
            <section className="verification-card">
                <div className="verification-icon">{error ? <MailCheck size={28} /> : <ShieldCheck size={28} />}</div>
                <span className="eyebrow">DORMDISH ACCOUNT SECURITY</span>
                <h1>{token ? (busy ? 'Verifying your email…' : error ? 'Verification link needs attention' : 'Email verified') : 'Verify your email address'}</h1>
                <p>{token ? (busy ? 'Checking the secure link from your email.' : error ? 'The link may have expired or already been used. Sign in and request a fresh verification email.' : 'Your account now has a verified email address.') : `Send a secure verification link to ${user?.email || 'your account email'}. The link expires after 24 hours.`}</p>
                {message && <div className="verification-success" role="status"><BadgeCheck size={17} /> {message}</div>}
                {error && <div className="form-error" role="alert">{error}</div>}
                {!token && <button type="button" className="primary-button full-button" onClick={sendAgain} disabled={busy || Boolean(user?.email_verified)}><MailCheck size={16} /> {busy ? 'Sending…' : user?.email_verified ? 'Email already verified' : 'Send verification email'}</button>}
                {token && !busy && !error && <button type="button" className="primary-button full-button" onClick={onDone || (() => { window.history.replaceState({}, '', window.location.pathname); window.location.reload(); })}>Continue to DormDish</button>}
                {!token && <button type="button" className="route-secondary-action verification-back" onClick={onBack}><ArrowLeft size={15} /> Back to profile</button>}
                {busy && !token && <p className="verification-subtle"><RefreshCw size={14} /> Sending can take a few seconds.</p>}
            </section>
        </main>
    );
}
