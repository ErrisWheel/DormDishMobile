import { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, MailCheck, Plus, RefreshCw, Save, Store, Trash2, Users } from 'lucide-react';
import { apiRequest, formatDate } from '../../lib/api.js';
import { ImageUploadField } from '../../components/ImageUploadField.jsx';
import { MediaImage } from '../../components/MediaImage.jsx';

const emptyUser = { name: '', email: '', password: '', role: 'store_manager', storeId: '' };
const emptyStore = { name: '', description: '', imageUrl: '/images/hero-food.png', locationName: '', mapsUrl: '', managerId: '' };

// Accounts
function UserManagementRow({ user, stores, onSave, onToast }) {
    const [form, setForm] = useState({
        name: user.name,
        email: user.email,
        role: user.role,
        storeId: user.store_id === null ? '' : String(user.store_id),
        isActive: Boolean(user.is_active)
    });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setForm({ name: user.name, email: user.email, role: user.role, storeId: user.store_id === null ? '' : String(user.store_id), isActive: Boolean(user.is_active) });
    }, [user]);

    function update(key, value) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    async function save() {
        setSaving(true);
        try {
            await onSave(user.id, {
                name: form.name,
                email: form.email,
                role: form.role,
                storeId: ['store_manager', 'rider'].includes(form.role) ? Number(form.storeId) : null,
                isActive: form.isActive
            });
        } finally {
            setSaving(false);
        }
    }

    return <tr><td><input className="table-input" value={form.name} onChange={(event) => update('name', event.target.value)} /></td><td><input className="table-input" type="email" value={form.email} onChange={(event) => update('email', event.target.value)} /></td><td><select className="table-select" value={form.role} onChange={(event) => update('role', event.target.value)}><option value="superadmin">Super Admin</option><option value="store_manager">Store Manager</option><option value="customer">Customer</option><option value="rider">Delivery Rider</option></select></td><td><select className="table-select" value={form.storeId} onChange={(event) => update('storeId', event.target.value)} disabled={!['store_manager', 'rider'].includes(form.role)}><option value="">No store</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></td><td><label className="table-active-toggle"><input type="checkbox" checked={form.isActive} onChange={(event) => update('isActive', event.target.checked)} />{form.isActive ? 'Active' : 'Disabled'}</label></td><td><button className="icon-button" disabled={saving || !form.name.trim() || !form.email.trim() || (['store_manager', 'rider'].includes(form.role) && !form.storeId)} onClick={save} aria-label={`Save ${user.name}`}><Save size={16} /></button></td></tr>;
}

// Stores
function StoreManagementCard({ store, users, onSave, onAssign, onDelete }) {
    const [form, setForm] = useState({ name: store.name, description: store.description, imageUrl: store.image_url, locationName: store.location_name, mapsUrl: store.maps_url, isActive: Boolean(store.is_active) });
    const [managerId, setManagerId] = useState(store.manager_id ? String(store.manager_id) : '');
    const [saving, setSaving] = useState(false);
    const managers = users.filter((user) => user.role === 'store_manager' && user.is_active);

    useEffect(() => {
        setForm({ name: store.name, description: store.description, imageUrl: store.image_url, locationName: store.location_name, mapsUrl: store.maps_url, isActive: Boolean(store.is_active) });
        setManagerId(store.manager_id ? String(store.manager_id) : '');
    }, [store]);

    async function save() {
        setSaving(true);
        try {
            await onSave(store.id, form);
        } finally {
            setSaving(false);
        }
    }

    return <article className="store-admin-card"><div className="store-admin-header"><MediaImage src={form.imageUrl || '/images/hero-food.png'} alt="" fallbackSrc="/images/hero-food.png" /><div><span className="eyebrow">STORE #{store.id}</span><h3>{store.name}</h3><p>{store.rating ? Number(store.rating).toFixed(1) : 'No'} rating · {store.rating_count} reviews</p></div></div><div className="form-grid"><label>Store name<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label><div className="form-span-two"><ImageUploadField kind="store" label="Store photo" value={form.imageUrl} onChange={(imageUrl) => setForm((current) => ({ ...current, imageUrl }))} /></div><label className="form-span-two">Description<input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label><label>Location name<input value={form.locationName} onChange={(event) => setForm((current) => ({ ...current, locationName: event.target.value }))} /></label><label>Google Maps URL<input value={form.mapsUrl} onChange={(event) => setForm((current) => ({ ...current, mapsUrl: event.target.value }))} /></label><label>Store Manager<select value={managerId} onChange={async (event) => { const next = event.target.value; setManagerId(next); await onAssign(store.id, next || null); }}><option value="">Unassigned</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label><label className="checkbox-field"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} /> Store available to customers</label></div><div className="store-admin-actions"><button className="primary-button" disabled={saving || !form.name.trim()} onClick={save}><Save size={15} /> Save store</button><button className="secondary-button" onClick={() => onDelete(store)}><Trash2 size={15} /> Archive / delete</button></div></article>;
}

// Admin dashboard
export function AdminDashboard({ page, onToast }) {
    const [users, setUsers] = useState([]);
    const [stores, setStores] = useState([]);
    const [ratings, setRatings] = useState([]);
    const [settings, setSettings] = useState({ app_name: 'DormDish', delivery_fee: '20', default_eta_minutes: '25', campus_location: 'TIPQC Main Building' });
    const [userForm, setUserForm] = useState(emptyUser);
    const [storeForm, setStoreForm] = useState(emptyStore);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [testingSmtp, setTestingSmtp] = useState(false);

    async function refresh() {
        setLoading(true);
        try {
            const [userResult, storeResult, settingsResult, ratingResult] = await Promise.all([
                apiRequest('/admin/users'),
                apiRequest('/admin/stores'),
                apiRequest('/admin/settings'),
                apiRequest('/admin/ratings')
            ]);
            setUsers(userResult.users);
            setStores(storeResult.stores);
            setSettings((current) => ({ ...current, ...settingsResult.settings }));
            setRatings(ratingResult.ratings);
            setError('');
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        refresh();
    }, []);

    async function saveUser(userId, body) {
        try {
            await apiRequest(`/admin/users/${userId}`, { method: 'PATCH', body });
            onToast('Account updated.');
            await refresh();
        } catch (requestError) {
            setError(requestError.message);
            throw requestError;
        }
    }

    async function createUser(event) {
        event.preventDefault();
        try {
            await apiRequest('/admin/users', {
                method: 'POST',
                body: { ...userForm, storeId: userForm.storeId ? Number(userForm.storeId) : null }
            });
            setUserForm(emptyUser);
            onToast('Account created.');
            await refresh();
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    async function saveStore(storeId, body) {
        try {
            await apiRequest(`/admin/stores/${storeId}`, { method: 'PATCH', body });
            onToast('Store updated.');
            await refresh();
        } catch (requestError) {
            setError(requestError.message);
            throw requestError;
        }
    }

    async function assignManager(storeId, managerId) {
        try {
            await apiRequest(`/admin/stores/${storeId}/manager`, { method: 'PATCH', body: { managerId } });
            onToast('Store manager assignment updated.');
            await refresh();
        } catch (requestError) {
            setError(requestError.message);
            throw requestError;
        }
    }

    // Register store
    async function createStore(event) {
        event.preventDefault();
        try {
            const { managerId, ...storePayload } = storeForm;
            const result = await apiRequest('/admin/stores', { method: 'POST', body: storePayload });
            if (managerId && result.store?.id) {
                await apiRequest(`/admin/stores/${result.store.id}/manager`, { method: 'PATCH', body: { managerId: Number(managerId) } });
            }
            setStoreForm(emptyStore);
            onToast(managerId ? 'Store created and manager assigned.' : 'Store created.');
            await refresh();
        } catch (requestError) {
            setError(requestError.message);
            await refresh();
        }
    }

    async function deleteStore(store) {
        if (!window.confirm(`Archive or delete ${store.name}? Stores with order history will be archived.`)) {
            return;
        }

        try {
            await apiRequest(`/admin/stores/${store.id}`, { method: 'DELETE' });
            onToast('Store record updated.');
            await refresh();
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    async function saveSettings(event) {
        event.preventDefault();
        try {
            await apiRequest('/admin/settings', { method: 'PATCH', body: settings });
            onToast('System settings saved.');
            await refresh();
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    // SMTP test
    async function testSmtp() {
        setTestingSmtp(true);
        setError('');
        try {
            const result = await apiRequest('/admin/smtp-test', { method: 'POST', body: {} });
            onToast(result.message || 'SMTP test email sent.');
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setTestingSmtp(false);
        }
    }

    async function toggleRating(rating) {
        try {
            await apiRequest(`/admin/ratings/${rating.id}`, { method: 'PATCH', body: { isVisible: !rating.is_visible } });
            onToast(rating.is_visible ? 'Rating hidden.' : 'Rating made visible.');
            await refresh();
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    const pageTitle = {
        'admin-users': 'Account management',
        'admin-stores': 'Store management',
        'admin-settings': 'System settings',
        'admin-ratings': 'Ratings moderation'
    }[page] || 'System overview';

    return (
        <div className="page-stack">
            <div className="dashboard-section-heading"><div><span className="eyebrow">SYSTEM ADMINISTRATION</span><h1>{pageTitle}</h1><p>Manage accounts, store registrations, settings, and rating moderation. Orders and products are intentionally excluded.</p></div><button className="secondary-button" onClick={refresh}><RefreshCw size={15} /> Refresh</button></div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="stats-grid"><div className="stat-card"><span>Accounts</span><strong>{users.length}</strong><small>All roles</small></div><div className="stat-card"><span>Active stores</span><strong>{stores.filter((store) => store.is_active).length}</strong><small>Visible storefronts</small></div><div className="stat-card"><span>Managers</span><strong>{users.filter((user) => user.role === 'store_manager').length}</strong><small>Store management accounts</small></div><div className="stat-card"><span>Ratings</span><strong>{ratings.length}</strong><small>Records available to moderate</small></div></div>
            {loading && <p className="muted-copy">Loading system records…</p>}
            {page === 'admin-users' && <>
                <section className="dashboard-panel"><div className="panel-heading"><div><h2>Create account</h2><p>Only Super Admin, Store Manager, and Delivery Rider accounts can be created here. Passwords are hashed before storage.</p></div><Users size={20} /></div><form className="product-editor-form" onSubmit={createUser}><div className="form-grid"><label>Full name<input value={userForm.name} onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))} required /></label><label>Email address<input type="email" value={userForm.email} onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))} required /></label><label>Temporary password<input type="password" minLength="8" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} required /></label><label>Role<select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value, storeId: ['store_manager', 'rider'].includes(event.target.value) ? current.storeId : '' }))}><option value="superadmin">Super Admin</option><option value="store_manager">Store Manager</option><option value="rider">Delivery Rider</option></select></label><label>Store assignment<select value={userForm.storeId} onChange={(event) => setUserForm((current) => ({ ...current, storeId: event.target.value }))} disabled={!['store_manager', 'rider'].includes(userForm.role)}><option value="">No store</option>{stores.filter((store) => store.is_active).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label></div><button className="primary-button" type="submit" disabled={['store_manager', 'rider'].includes(userForm.role) && !userForm.storeId}><Plus size={16} /> Create account</button></form></section>
                <section className="dashboard-panel"><div className="panel-heading"><div><h2>Accounts</h2><p>Change roles and store associations carefully.</p></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Store</th><th>Access</th><th>Save</th></tr></thead><tbody>{users.map((user) => <UserManagementRow key={user.id} user={user} stores={stores} onSave={saveUser} onToast={onToast} />)}</tbody></table></div></section>
            </>}
            {page === 'admin-stores' && <>
                <section className="dashboard-panel"><div className="panel-heading"><div><h2>Register a store</h2><p>Store names can be replaced with real canteen names later.</p></div><Store size={20} /></div><form className="product-editor-form" onSubmit={createStore}><div className="form-grid"><label>Store name<input value={storeForm.name} onChange={(event) => setStoreForm((current) => ({ ...current, name: event.target.value }))} required /></label><div className="form-span-two"><ImageUploadField kind="store" label="Store photo" value={storeForm.imageUrl} onChange={(imageUrl) => setStoreForm((current) => ({ ...current, imageUrl }))} /></div><label className="form-span-two">Description<input value={storeForm.description} onChange={(event) => setStoreForm((current) => ({ ...current, description: event.target.value }))} /></label><label>Location name<input value={storeForm.locationName} onChange={(event) => setStoreForm((current) => ({ ...current, locationName: event.target.value }))} /></label><label>Google Maps URL<input value={storeForm.mapsUrl} onChange={(event) => setStoreForm((current) => ({ ...current, mapsUrl: event.target.value }))} /></label><label>Assign manager<select value={storeForm.managerId} onChange={(event) => setStoreForm((current) => ({ ...current, managerId: event.target.value }))}><option value="">Assign later</option>{users.filter((user) => user.role === 'store_manager' && user.is_active).map((manager) => <option key={manager.id} value={manager.id}>{manager.name} · {manager.email}</option>)}</select><small>Managers can be reassigned from the store cards below.</small></label></div><button className="primary-button" type="submit"><Plus size={16} /> Register store</button></form></section>
                <div className="store-admin-grid">{stores.map((store) => <StoreManagementCard key={store.id} store={store} users={users} onSave={saveStore} onAssign={assignManager} onDelete={deleteStore} />)}</div>
            </>}
            {page === 'admin-settings' && <section className="dashboard-panel"><div className="panel-heading"><div><h2>General settings</h2><p>These values are read by local API and checkout workflows.</p></div></div><form className="product-editor-form" onSubmit={saveSettings}><div className="form-grid"><label>Application name<input value={settings.app_name} onChange={(event) => setSettings((current) => ({ ...current, app_name: event.target.value }))} required /></label><label>Delivery fee (₱)<input type="number" min="0" step="0.01" value={settings.delivery_fee} onChange={(event) => setSettings((current) => ({ ...current, delivery_fee: event.target.value }))} required /></label><label>Default ETA (minutes)<input type="number" min="0" max="240" value={settings.default_eta_minutes} onChange={(event) => setSettings((current) => ({ ...current, default_eta_minutes: event.target.value }))} required /></label><label>Campus location<input value={settings.campus_location} onChange={(event) => setSettings((current) => ({ ...current, campus_location: event.target.value }))} required /></label></div><button className="primary-button" type="submit"><Save size={16} /> Save settings</button></form><div className="panel-heading smtp-test-panel"><div><h2>SMTP email test</h2><p>Send a test message from the live backend to the configured support inbox. Check Render logs if this fails.</p></div><button className="secondary-button" type="button" onClick={testSmtp} disabled={testingSmtp}><MailCheck size={16} /> {testingSmtp ? "Sending…" : "Send test email"}</button></div></section>}
            {page === 'admin-ratings' && <section className="dashboard-panel"><div className="panel-heading"><div><h2>Ratings and reviews</h2><p>Hidden ratings are excluded from storefront averages.</p></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Store</th><th>Reviewer</th><th>Rating</th><th>Review</th><th>Created</th><th>Visibility</th></tr></thead><tbody>{ratings.map((rating) => <tr key={rating.id}><td>{rating.store_name}</td><td>{rating.reviewer_name}</td><td>{rating.score}/5</td><td className="rating-review-cell">{rating.review || 'No written review'}</td><td>{formatDate(rating.created_at)}</td><td><button className="secondary-button small-button" onClick={() => toggleRating(rating)}>{rating.is_visible ? <Eye size={15} /> : <EyeOff size={15} />}{rating.is_visible ? 'Visible' : 'Hidden'}</button></td></tr>)}</tbody></table></div></section>}
        </div>
    );
}
