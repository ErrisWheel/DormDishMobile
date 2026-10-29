import { useState } from 'react';
import { ArrowLeft, Headset, Send } from 'lucide-react';
import { apiRequest } from '../lib/api.js';

// Support
export function SupportPage({ user = null, onBack }) {
    const [form, setForm] = useState({ name: user?.name || '', contactNumber: '', email: user?.email || '', message: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    function update(key, value) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    async function submit(event) {
        event.preventDefault();
        setBusy(true);
        setError('');
        setSuccess('');
        try {
            const result = await apiRequest('/support', { method: 'POST', body: form });
            setSuccess(result.message || 'Your message was sent to DormDish Support.');
            setForm((current) => ({ ...current, message: '' }));
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setBusy(false);
        }
    }

    const formBody = <>
        <div className="form-grid">
            <label>Full name<input value={form.name} onChange={(event) => update('name', event.target.value)} autoComplete="name" minLength={2} maxLength={100} required /></label>
            <label>Contact number<input type="tel" value={form.contactNumber} onChange={(event) => update('contactNumber', event.target.value)} autoComplete="tel" minLength={5} maxLength={30} required placeholder="e.g. 09xx xxx xxxx" /></label>
            <label className="form-span-two">Email address<input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} autoComplete="email" maxLength={254} required /></label>
            <label className="form-span-two">Message<textarea value={form.message} onChange={(event) => update('message', event.target.value)} minLength={10} maxLength={4000} rows={5} required placeholder="Tell us what you need help with…" /></label>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        {success && <div className="form-success" role="status">{success}</div>}
        <button className="primary-button" type="submit" disabled={busy}><Send size={16} /> {busy ? 'Sending…' : 'Send message'}</button>
    </>;

    if (!user) {
        return <main className="auth-shell"><section className="auth-card support-auth-card">
            <button className="secondary-button" type="button" onClick={onBack}><ArrowLeft size={16} /> Back to sign in</button>
            <div className="auth-brand"><span className="brand-mark"><Headset size={22} /></span><span>Dorm<span>Dish</span><small>Contact support</small></span></div>
            <div className="auth-heading"><span className="eyebrow">WE'RE HERE TO HELP</span><h1>Contact DormDish</h1><p>Send your message and our team will receive it at dormdishdelivery@gmail.com.</p></div>
            <form className="product-editor-form" onSubmit={submit}>{formBody}</form>
        </section></main>;
    }

    return <div className="page-stack"><div className="dashboard-section-heading"><div><span className="eyebrow">SUPPORT</span><h1>Contact DormDish</h1><p>Tell us what you need help with. A reply can be sent to the email address you provide.</p></div><button className="secondary-button" onClick={onBack}><ArrowLeft size={16} /> Back</button></div><section className="dashboard-panel"><div className="panel-heading"><div><h2>Send a message</h2><p>Your name, contact number, email, and message are sent to DormDish Support.</p></div><Headset size={20} /></div><form className="product-editor-form" onSubmit={submit}>{formBody}</form></section></div>;
}
