import { useState } from 'react';
import { BadgeCheck, Check, ExternalLink, Heart, MapPin, PackageCheck, ShieldCheck, UserRound } from 'lucide-react';
import { deliveryDestinationUrl } from '../../lib/maps.js';

export function CustomerProfilePage({ user, address, onAddress, onSave, orders, favorites }) {
    const [name, setName] = useState(user.name);
    const [saving, setSaving] = useState(false);

    async function submit(event) {
        event.preventDefault();
        setSaving(true);
        await onSave(name.trim());
        setSaving(false);
    }

    const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('');

    return (
        <div className="page-stack profile-page">
            <div className="dashboard-section-heading"><div><span className="eyebrow">ACCOUNT & PREFERENCES</span><h1>My profile</h1><p>Manage your account details and the address used for your next delivery.</p></div></div>

            <section className="profile-identity-card">
                <div className="profile-identity-avatar">{initials || <UserRound size={26} />}</div>
                <div className="profile-identity-copy"><span className="profile-member-label"><BadgeCheck size={15} /> DormDish customer</span><h2>{user.name}</h2><p>{user.email}</p></div>
                <div className="profile-secure-pill"><ShieldCheck size={15} /> Account secured</div>
            </section>

            <div className="profile-content-grid">
                <section className="dashboard-panel customer-profile-panel profile-edit-panel">
                    <div className="panel-heading"><div><h2>Personal details</h2><p>Keep your account information accurate.</p></div><UserRound size={21} /></div>
                    <form className="product-editor-form" onSubmit={submit}>
                        <div className="form-grid">
                            <label className="form-span-two">Display name<input value={name} onChange={(event) => setName(event.target.value)} minLength="2" maxLength="80" autoComplete="name" required /></label>
                            <label className="form-span-two">Email address<input value={user.email} readOnly autoComplete="email" /><small>Your login email is managed by the demo account.</small></label>
                        </div>
                        <button className="primary-button" type="submit" disabled={saving || !name.trim()}><Check size={16} /> {saving ? 'Saving changes…' : 'Save changes'}</button>
                    </form>
                </section>

                <section className="dashboard-panel profile-address-panel">
                    <div className="panel-heading"><div><h2>Delivery address</h2><p>Used as the destination for new orders.</p></div><MapPin size={21} /></div>
                    <label className="stacked-field">Usual delivery location<textarea value={address} onChange={(event) => onAddress(event.target.value)} rows="4" maxLength="240" placeholder="Building, dorm, room, or pickup point" /></label>
                    <div className="address-guidance"><MapPin size={16} /><span>Be specific, such as your building, dorm, street, and a nearby landmark, so Google Maps can estimate the route more accurately.</span></div>
                    <a className="secondary-button profile-map-link" href={deliveryDestinationUrl(address)} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Check address in Google Maps</a>
                </section>
            </div>

            <div className="stats-grid profile-stats-grid">
                <div className="stat-card profile-stat-card"><span>Orders placed</span><strong>{orders.length}</strong><small><PackageCheck size={14} /> Order history in SQLite</small></div>
                <div className="stat-card profile-stat-card"><span>Saved favorites</span><strong>{favorites.length}</strong><small><Heart size={14} /> Saved on this device</small></div>
                <div className="stat-card profile-stat-card"><span>Delivery address</span><strong className="profile-location-status">{address.trim() ? 'Saved locally' : 'Not set'}</strong><small><MapPin size={14} /> Used for future checkouts</small></div>
            </div>
        </div>
    );
}
