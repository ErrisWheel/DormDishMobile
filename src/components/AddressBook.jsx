import { useEffect, useState } from 'react';
import { Check, Edit3, Home, MapPin, Plus, Star, Trash2, X } from 'lucide-react';
import { apiRequest } from '../lib/api.js';
import { AddressMapPicker } from './AddressMapPicker.jsx';

const blankForm = (name = '') => ({ addressLabel: 'Home', recipientName: name, contactNumber: '', addressText: '', deliveryInstructions: '', latitude: null, longitude: null, isDefault: false });

// Address book
export function AddressBook({ user, addresses, onRefresh, onUseAddress }) {
    const [editingId, setEditingId] = useState(null);
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(() => blankForm(user.name));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open) setForm(blankForm(user.name));
    }, [open, user.name]);

    function beginCreate() {
        setEditingId(null);
        setForm(blankForm(user.name));
        setError('');
        setOpen(true);
    }

    function beginEdit(address) {
        setEditingId(address.id);
        setForm({
            addressLabel: address.address_label || 'Home',
            recipientName: address.recipient_name || user.name,
            contactNumber: address.contact_number || '',
            addressText: address.address_text || '',
            deliveryInstructions: address.delivery_instructions || '',
            latitude: address.latitude == null ? null : Number(address.latitude),
            longitude: address.longitude == null ? null : Number(address.longitude),
            isDefault: Boolean(Number(address.is_default))
        });
        setError('');
        setOpen(true);
    }

    function changeField(field, value) {
        setForm((current) => ({ ...current, [field]: value }));
    }

    async function save(event) {
        event.preventDefault();
        setError('');
        const hasMapPin = form.latitude != null && form.longitude != null && Number.isFinite(Number(form.latitude)) && Number.isFinite(Number(form.longitude));
        if (String(form.addressText || '').trim().length < 5 && !hasMapPin) {
            setError('Enter a delivery address or choose a point on the map.');
            return;
        }
        setSaving(true);
        try {
            await apiRequest(editingId ? `/customer/addresses/${editingId}` : '/customer/addresses', {
                method: editingId ? 'PATCH' : 'POST',
                body: form
            });
            await onRefresh();
            setOpen(false);
        } catch (requestError) {
            setError(requestError.message || 'Could not save this address.');
        } finally {
            setSaving(false);
        }
    }

    async function makeDefault(address) {
        try {
            await apiRequest(`/customer/addresses/${address.id}`, {
                method: 'PATCH',
                body: {
                    addressLabel: address.address_label,
                    recipientName: address.recipient_name,
                    contactNumber: address.contact_number,
                    addressText: address.address_text,
                    deliveryInstructions: address.delivery_instructions || '',
                    latitude: address.latitude,
                    longitude: address.longitude,
                    isDefault: true
                }
            });
            await onRefresh();
        } catch (requestError) {
            setError(requestError.message || 'Could not update the default address.');
        }
    }

    async function remove(address) {
        if (!window.confirm(`Delete the saved address “${address.address_label}”?`)) return;
        try {
            await apiRequest(`/customer/addresses/${address.id}`, { method: 'DELETE' });
            await onRefresh();
        } catch (requestError) {
            setError(requestError.message || 'Could not delete this address.');
        }
    }

    return (
        <section className="dashboard-panel profile-address-panel address-book-panel">
            <div className="panel-heading"><div><h2>Saved delivery addresses</h2><p>Save Home, Dorm, Work, or any delivery point with instructions for the rider.</p></div><MapPin size={21} /></div>
            {error && <div className="form-error" role="alert">{error}</div>}
            {addresses.length > 0 ? <div className="saved-address-list">{addresses.map((address) => <article className="saved-address-card" key={address.id}>
                <div className="saved-address-icon"><Home size={19} /></div>
                <div className="saved-address-copy"><div className="saved-address-title"><strong>{address.address_label}</strong>{Number(address.is_default) === 1 && <span className="default-address-pill"><Star size={12} fill="currentColor" /> Default</span>}</div>
                    <p>{address.address_text}</p><small>{address.recipient_name} · {address.contact_number}</small>
                    {address.delivery_instructions && <div className="saved-address-instructions">Instructions: {address.delivery_instructions}</div>}
                    {address.latitude != null && address.longitude != null && <small className="saved-address-coordinates">Map pin: {Number(address.latitude).toFixed(5)}, {Number(address.longitude).toFixed(5)}</small>}
                    <div className="saved-address-actions"><button type="button" className="secondary-button small-button" onClick={() => onUseAddress(address)}><Check size={14} /> Use for checkout</button>{!Number(address.is_default) && <button type="button" className="text-action" onClick={() => makeDefault(address)}>Make default</button>}<button type="button" className="icon-button" title="Edit address" aria-label="Edit address" onClick={() => beginEdit(address)}><Edit3 size={15} /></button><button type="button" className="icon-button danger-icon" title="Delete address" aria-label="Delete address" onClick={() => remove(address)}><Trash2 size={15} /></button></div>
                </div>
            </article>)}</div> : <div className="empty-address-list"><MapPin size={22} /><p>No saved delivery addresses yet. Add one so checkout is faster next time.</p></div>}
            {!open && <button type="button" className="primary-button" onClick={beginCreate}><Plus size={16} /> Add a delivery address</button>}
            {open && <form className="saved-address-editor" onSubmit={save}>
                <div className="panel-heading"><div><h3>{editingId ? 'Edit address' : 'Add an address'}</h3><p>Pick the pin on the map or look up your address.</p></div><button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close address form"><X size={17} /></button></div>
                <div className="form-grid">
                    <label>Save as<input value={form.addressLabel} onChange={(event) => changeField('addressLabel', event.target.value)} maxLength="40" placeholder="Home, Dorm, Work" required /></label>
                    <label>Recipient name<input value={form.recipientName} onChange={(event) => changeField('recipientName', event.target.value)} maxLength="100" required /></label>
                    <label>Contact number<input type="tel" value={form.contactNumber} onChange={(event) => changeField('contactNumber', event.target.value)} maxLength="30" minLength="5" required /></label>
                    <label className="form-span-two">Full address<textarea value={form.addressText} onChange={(event) => changeField('addressText', event.target.value)} rows="3" maxLength="300" placeholder="Type an address, or select a map pin below" /></label>
                </div>
                <AddressMapPicker addressText={form.addressText} onAddressTextChange={(value) => changeField('addressText', value)} coordinates={{ latitude: form.latitude, longitude: form.longitude }} onCoordinatesChange={(point) => setForm((current) => ({ ...current, latitude: point.latitude, longitude: point.longitude }))} />
                <label className="stacked-field address-instructions-field">Delivery instructions<textarea value={form.deliveryInstructions} onChange={(event) => changeField('deliveryInstructions', event.target.value)} rows="2" maxLength="500" placeholder="Meet at lobby, call when at gate, leave with guard…" /></label>
                <label className="address-default-check"><input type="checkbox" checked={form.isDefault} onChange={(event) => changeField('isDefault', event.target.checked)} /> Make this my default delivery address</label>
                {error && <div className="form-error" role="alert">{error}</div>}
                <div className="saved-address-editor-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save address'}</button></div>
            </form>}
        </section>
    );
}
