import { useState } from 'react';
import { BadgeCheck, Check, Heart, PackageCheck, ShieldCheck, UserRound, MailCheck } from 'lucide-react';
import { ImageUploadField } from '../../components/ImageUploadField.jsx';
import { MediaImage } from '../../components/MediaImage.jsx';
import { AddressBook } from '../../components/AddressBook.jsx';

// Profile
export function CustomerProfilePage({ user, address, onAddress, addresses = [], onRefreshAddresses, onUseAddress, onSave, onVerify, orders, favorites }) {
    const [name, setName] = useState(user.name);
    const [profileImageUrl, setProfileImageUrl] = useState(user.profile_image_url || '');
    const [saving, setSaving] = useState(false);

    async function submit(event) {
        event.preventDefault();
        setSaving(true);
        await onSave({ name: name.trim(), profileImageUrl });
        setSaving(false);
    }

    const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('');

    return (
        <div className="page-stack profile-page">
            <div className="dashboard-section-heading"><div><span className="eyebrow">ACCOUNT & PREFERENCES</span><h1>My profile</h1><p>Manage your account details, photo, verification, and delivery address.</p></div></div>

            <section className="profile-identity-card">
                <div className="profile-identity-avatar">{profileImageUrl ? <MediaImage src={profileImageUrl} alt="Profile" className="profile-avatar-media" fallbackText={initials || (user.name?.charAt(0)?.toUpperCase() || '?')} /> : initials || <UserRound size={26} />}</div>
                <div className="profile-identity-copy"><span className="profile-member-label"><BadgeCheck size={15} /> DormDish customer</span><h2>{user.name}</h2><p>{user.email}</p></div>
                <div className={`profile-secure-pill ${Number(user.email_verified) ? 'verified-pill' : ''}`}>{Number(user.email_verified) ? <BadgeCheck size={15} /> : <ShieldCheck size={15} />}{Number(user.email_verified) ? 'Email verified' : 'Email not verified'}</div>
            </section>

            <div className="profile-content-grid">
                <section className="dashboard-panel customer-profile-panel profile-edit-panel">
                    <div className="panel-heading"><div><h2>Personal details</h2><p>Keep your account information accurate.</p></div><UserRound size={21} /></div>
                    <form className="product-editor-form" onSubmit={submit}>
                        <ImageUploadField kind="profile" label="Profile photo" value={profileImageUrl} onChange={setProfileImageUrl} />
                        <div className="form-grid">
                            <label className="form-span-two">Display name<input value={name} onChange={(event) => setName(event.target.value)} minLength="2" maxLength="80" autoComplete="name" required /></label>
                            <label className="form-span-two">Email address<input value={user.email} readOnly autoComplete="email" /><small>Your login email is managed by your account.</small></label>
                        </div>
                        <button className="primary-button" type="submit" disabled={saving || !name.trim()}><Check size={16} /> {saving ? 'Saving changes…' : 'Save changes'}</button>
                    </form>
                </section>

                <section className="dashboard-panel profile-address-panel">
                    <div className="panel-heading"><div><h2>Email verification</h2><p>Send a secure link to your login email address.</p></div><MailCheck size={21} /></div>
                    <p>{Number(user.email_verified) ? 'Your email address has been verified.' : 'Verify your email to confirm that you can receive DormDish account messages.'}</p>
                    <button className="primary-button" type="button" onClick={onVerify}><MailCheck size={16} /> {Number(user.email_verified) ? 'View verification status' : 'Verify my account'}</button>
                </section>

                <AddressBook user={user} addresses={addresses} onRefresh={onRefreshAddresses} onUseAddress={onUseAddress} />
            </div>

            <div className="stats-grid profile-stats-grid">
                <div className="stat-card profile-stat-card"><span>Orders placed</span><strong>{orders.length}</strong><small><PackageCheck size={14} /> Order history in DormDish</small></div>
                <div className="stat-card profile-stat-card"><span>Saved favorites</span><strong>{favorites.length}</strong><small><Heart size={14} /> Saved on this device</small></div>
                <div className="stat-card profile-stat-card"><span>Saved addresses</span><strong className="profile-location-status">{addresses.length}</strong><small><PackageCheck size={14} /> Stored in your DormDish account</small></div>
            </div>
        </div>
    );
}
