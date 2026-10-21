import { useState } from 'react';
import { ArrowRight, KeyRound, Moon, ShieldCheck, Sun, Utensils } from 'lucide-react';
import { apiRequest, saveSession } from '../lib/api.js';

const demoAccounts = [
    { label: 'Super Admin', email: 'superadmin@dormdish.test' },
    { label: 'Store Manager Alpha', email: 'manager.alpha@dormdish.test' },
    { label: 'Store Manager Beta', email: 'manager.beta@dormdish.test' },
    { label: 'Store Manager Gamma', email: 'manager.gamma@dormdish.test' },
    { label: 'Customer', email: 'customer@dormdish.test' },
    { label: 'Delivery Rider', email: 'rider@dormdish.test' }
];

export function LoginPage({ onLogin, dark, onToggleDark }) {
    const [email, setEmail] = useState('customer@dormdish.test');
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
                <div className="demo-access">
                    <div className="demo-access-title"><KeyRound size={16} /><strong>School demo accounts</strong></div>
                    <p>Select an email, then enter its password from the local demo credentials.</p>
                    <div className="demo-account-grid">
                        {demoAccounts.map((account) => (
                            <button key={account.email} type="button" onClick={() => { setEmail(account.email); setPassword(''); setError(''); }}>
                                {account.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="auth-note"><ShieldCheck size={16} /><span>Passwords are hashed in the local SQLite database. Demo accounts are for classroom testing only.</span></div>
            </section>
        </main>
    );
}
