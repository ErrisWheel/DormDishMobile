import { useState } from 'react';
import { ArrowRight, Mail, Moon, ShieldCheck, Sun, Utensils } from 'lucide-react';
import { apiRequest, saveSession } from '../lib/api.js';

export function LoginPage({ onLogin, onSupport, dark, onToggleDark }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    async function submit(event) {
        event.preventDefault();
        setError('');
        setLoading(true);

        try {
            const result = await apiRequest('/auth/login', {
                method: 'POST',
                body: { email, password }
            });
            saveSession(result.token, result.user);
            onLogin(result.user);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="auth-shell">
            <button className="icon-button auth-theme-toggle" type="button" onClick={onToggleDark} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Light mode' : 'Dark mode'}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
            <section className="auth-card">
                <div className="auth-brand">
                    <span className="brand-mark"><Utensils size={22} /></span>
                    <span>Dorm<span>Dish</span><small>Campus dining, simplified</small></span>
                </div>
                <div className="auth-heading">
                    <span className="eyebrow">WELCOME BACK</span>
                    <h1>Good food starts here.</h1>
                    <p>Sign in to explore campus stores, manage orders, or update delivery progress.</p>
                </div>
                <form className="auth-form" onSubmit={submit}>
                    <label htmlFor="login-email">Email address</label>
                    <input id="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
                    <label htmlFor="login-password">Password</label>
                    <input id="login-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
                    {error && <div className="form-error" role="alert">{error}</div>}
                    <button className="primary-button full-button" type="submit" disabled={loading}>
                        {loading ? 'Signing in…' : 'Sign in'}
                        <ArrowRight size={17} />
                    </button>
                </form>
                <button className="secondary-button full-button auth-support-button" type="button" onClick={onSupport}>
                    <Mail size={16} /> Contact support
                </button>
                <div className="auth-note"><ShieldCheck size={16} /><span>Your account is protected. Contact support if you need help signing in.</span></div>
            </section>
        </main>
    );
}
