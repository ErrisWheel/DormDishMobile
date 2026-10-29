import { useState } from 'react';
import { AlertTriangle, ShieldAlert, Trash2 } from 'lucide-react';

// Account deletion
export function DeleteAccountPanel({ onDeleteAccount }) {
    const [confirming, setConfirming] = useState(false);
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    async function deleteAccount() {
        if (confirmation.trim() !== 'DELETE') return;
        setBusy(true);
        setError('');
        try {
            await onDeleteAccount();
        } catch (requestError) {
            setError(requestError?.message || 'Your account could not be deleted. Please try again.');
            setBusy(false);
        }
    }

    function cancel() {
        if (busy) return;
        setConfirming(false);
        setConfirmation('');
        setError('');
    }

    return (
        <section className="dashboard-panel delete-account-panel" aria-labelledby="delete-account-title">
            <div className="delete-account-heading">
                <span className="delete-account-icon"><ShieldAlert size={20} /></span>
                <div><span className="eyebrow">DANGER ZONE</span><h2 id="delete-account-title">Delete account</h2></div>
            </div>
            <p>Deleting your account signs you out, removes your profile photo and saved addresses, and clears personal delivery details. Existing order records may be retained in anonymized form for store operations and order history. This action cannot be undone.</p>
            {!confirming ? (
                <button type="button" className="danger-button" onClick={() => { setConfirming(true); setError(''); }}><Trash2 size={16} /> Delete my account</button>
            ) : (
                <div className="delete-account-confirmation">
                    <div className="delete-account-warning"><AlertTriangle size={18} /><span>This is permanent. To confirm, type <strong>DELETE</strong> below.</span></div>
                    <label htmlFor="delete-account-confirmation">Type DELETE to continue<input id="delete-account-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck="false" disabled={busy} /></label>
                    {error && <div className="form-error" role="alert">{error}</div>}
                    <div className="delete-account-actions">
                        <button type="button" className="secondary-button" onClick={cancel} disabled={busy}>Cancel</button>
                        <button type="button" className="danger-button" onClick={deleteAccount} disabled={busy || confirmation.trim() !== 'DELETE'}><Trash2 size={16} /> {busy ? 'Deleting account…' : 'Permanently delete'}</button>
                    </div>
                </div>
            )}
        </section>
    );
}
