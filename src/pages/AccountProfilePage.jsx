import { useState } from 'react';
import { BadgeCheck, Check, MailCheck, ShieldCheck, UserRound } from 'lucide-react';
import { roleLabel } from '../lib/api.js';
import { ImageUploadField } from '../components/ImageUploadField.jsx';

export function AccountProfilePage({ user, onSave, onVerify }) {
    const [name, setName] = useState(user.name || '');
    const [profileImageUrl, setProfileImageUrl] = useState(user.profile_image_url || '');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');

    async function submit(event) {
        event.preventDefault();
        setSaving(true);
        setSaved(false);
        setError('');
        try {
            const success = await onSave({ name: name.trim(), profileImageUrl });
            if (success === false) throw new Error('Your profile could not be saved. Review the error message and try again.');
            setSaved(true);
        } catch (requestError) {
            setError(requestError.message || 'Your profile could not be saved.');
        } finally {
            setSaving(false);
        }
    }

    const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('');

    return (
        <div className="page-stack profile-page">
            <div className="dashboard-section-heading"><div><span className="eyebrow">ACCOUNT SETTINGS</span><h1>My account</h1><p>Manage the name and photo shown across your DormDish workspace.</p></div></div>
            <section className="profile-identity-card">
                <div className="profile-identity-avatar">{profileImageUrl ? <img src={profileImageUrl} alt="Account profile" /> : initials || <UserRound size={26} />}</div>
                <div className="profile-identity-copy"><span className="profile-member-label"><BadgeCheck size={15} /> {roleLabel(user.role)}</span><h2>{user.name}</h2><p>{user.email}</p></div>
                <div className={`profile-secure-pill ${Number(user.email_verified) ? 'verified-pill' : ''}`}>{Number(user.email_verified) ? <BadgeCheck size={15} /> : <ShieldCheck size={15} />}{Number(user.email_verified) ? 'Email verified' : 'Email not verified'}</div>
            </section>
            <div className="profile-content-grid">
                <section className="dashboard-panel customer-profile-panel profile-edit-panel">
                    <div className="panel-heading"><div><h2>Profile details</h2><p>Your details are saved to the DormDish database.</p></div><UserRound size={21} /></div>
                    <form className="product-editor-form" onSubmit={submit}>
                        <ImageUploadField kind="profile" label="Profile photo" value={profileImageUrl} onChange={setProfileImageUrl} />
                        <div className="form-grid">
                            <label className="form-span-two">Display name<input value={name} onChange={(event) => setName(event.target.value)} minLength="2" maxLength="100" autoComplete="name" required /></label>
                            <label className="form-span-two">Email address<input value={user.email} readOnly autoComplete="email" /><small>Your login email is managed by your account.</small></label>
                        </div>
                        {error && <div className="form-error" role="alert">{error}</div>}
                        {saved && <div className="verification-success" role="status"><Check size={16} /> Profile changes saved.</div>}
                        <button className="primary-button" type="submit" disabled={saving || !name.trim()}><Check size={16} /> {saving ? 'Saving changes…' : 'Save changes'}</button>
                    </form>
                </section>
                <section className="dashboard-panel profile-address-panel">
                    <div className="panel-heading"><div><h2>Email verification</h2><p>Verification links are sent to your login email.</p></div><MailCheck size={21} /></div>
                    <p>{Number(user.email_verified) ? 'Your email address has been verified.' : 'Verify your email to confirm that you can receive DormDish account messages.'}</p>
                    <button className="primary-button" type="button" onClick={onVerify}><MailCheck size={16} /> {Number(user.email_verified) ? 'View verification status' : 'Verify my account'}</button>
                </section>
            </div>
        </div>
    );
}
