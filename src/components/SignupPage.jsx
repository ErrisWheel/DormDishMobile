import { useState } from 'react';
import { ArrowLeft, ArrowRight, MapPin, ShieldCheck, Utensils } from 'lucide-react';
import { apiRequest, saveSession } from '../lib/api.js';
import { AddressMapPicker } from './AddressMapPicker.jsx';

// Signup form
export function SignupPage({ onLogin, onBack }) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [contactNumber, setContactNumber] = useState('');
    const [recipientName, setRecipientName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [addressLabel, setAddressLabel] = useState('Home');
    const [addressText, setAddressText] = useState('');
    const [deliveryInstructions, setDeliveryInstructions] = useState('');
    const [coordinates, setCoordinates] = useState({ latitude: null, longitude: null });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    async function submit(event) {
        event.preventDefault();
        setError('');
        if (password !== confirmPassword) return setError('Passwords do not match.');
        const hasMapPin = coordinates.latitude != null && coordinates.longitude != null && Number.isFinite(Number(coordinates.latitude)) && Number.isFinite(Number(coordinates.longitude));
        if (addressText.trim().length < 5 && !hasMapPin) return setError('Enter a delivery address or choose a point on the map.');
        setLoading(true);
        try {
            const result = await apiRequest('/auth/register', {
                method: 'POST',
                body: {
                    name, email, password, contactNumber, recipientName: recipientName || name, addressLabel, addressText,
                    deliveryInstructions,
                    latitude: coordinates.latitude,
                    longitude: coordinates.longitude
                }
            });
            saveSession(result.token, result.user);
            onLogin(result.user, result);
        } catch (requestError) {
            setError(requestError.message || 'Could not create your account.');
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="auth-shell signup-shell">
            <section className="auth-card signup-card">
                <button className="back-link signup-back" type="button" onClick={onBack}><ArrowLeft size={16} /> Back to sign in</button>
                <div className="auth-brand"><span className="brand-mark"><Utensils size={22} /></span><span>Dorm<span>Dish</span><small>Campus dining, simplified</small></span></div>
                <div className="auth-heading"><span className="eyebrow">CREATE YOUR ACCOUNT</span><h1>Sign up for DormDish.</h1><p>Create a customer account and save your first delivery address.</p></div>
                <form className="auth-form signup-form" onSubmit={submit}>
                    <div className="form-grid">
                        <label className="form-span-two">Full name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" minLength="2" maxLength="100" required /></label>
                        <label className="form-span-two">Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
                        <label className="form-span-two">Contact number<input type="tel" value={contactNumber} onChange={(event) => setContactNumber(event.target.value)} autoComplete="tel" minLength="5" maxLength="30" placeholder="e.g. 09XX XXX XXXX" required /></label>
                        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength="8" maxLength="128" required /><small>At least 8 characters.</small></label>
                        <label>Confirm password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength="8" maxLength="128" required /></label>
                    </div>
                    <div className="signup-address-section"><div className="signup-section-heading"><MapPin size={18} /><div><strong>Delivery address</strong><small>You can save more addresses after signing in.</small></div></div>
                        <div className="form-grid">
                            <label>Save as<input value={addressLabel} onChange={(event) => setAddressLabel(event.target.value)} placeholder="Home, Dorm, Office" maxLength="40" required /></label>
                            <label>Recipient name<input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} autoComplete="name" minLength="2" maxLength="100" placeholder={name || 'Who should receive the order?'} /></label>
                            <label className="form-span-two">Complete delivery address<textarea value={addressText} onChange={(event) => setAddressText(event.target.value)} rows="3" maxLength="300" placeholder="Type an address, or select a map pin below" /></label>
                        </div>
                        <AddressMapPicker addressText={addressText} onAddressTextChange={setAddressText} coordinates={coordinates} onCoordinatesChange={setCoordinates} />
                        <label className="stacked-field signup-instructions">Delivery instructions<textarea value={deliveryInstructions} onChange={(event) => setDeliveryInstructions(event.target.value)} rows="2" maxLength="500" placeholder="Meet at the lobby, call when outside, guardhouse instructions…" /></label>
                    </div>
                    {error && <div className="form-error" role="alert">{error}</div>}
                    <button className="primary-button full-button" type="submit" disabled={loading}>{loading ? 'Creating account…' : 'Create customer account'} <ArrowRight size={17} /></button>
                    <div className="auth-note"><ShieldCheck size={16} /><span>Your account is created as a customer account. Staff accounts are created by Super Admin.</span></div>
                </form>
                <button className="secondary-button full-button" type="button" onClick={onBack}>Already have an account? Sign in</button>
            </section>
        </main>
    );
}
