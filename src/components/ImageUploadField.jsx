import { useRef, useState } from 'react';
import { Camera, ImagePlus, UploadCloud } from 'lucide-react';
import { apiRequest } from '../lib/api.js';

function fileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('The selected image could not be read.'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
    });
}

export function ImageUploadField({ kind, value, onChange, label = 'Image', help = 'JPG, PNG, WEBP or AVIF · max 5 MB', className = '' }) {
    const chooseRef = useRef(null);
    const cameraRef = useRef(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    async function handleFile(file) {
        if (!file) return;
        setError('');
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) {
            setError('Choose a JPG, PNG, WEBP or AVIF image.');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setError('The image must be smaller than 5 MB.');
            return;
        }
        setBusy(true);
        try {
            const data = await fileAsDataUrl(file);
            const result = await apiRequest(`/uploads/${kind}`, {
                method: 'POST',
                body: { filename: file.name || `${kind}-image`, mimeType: file.type, data }
            });
            onChange(result.url);
        } catch (uploadError) {
            setError(uploadError.message || 'The image upload failed.');
        } finally {
            setBusy(false);
            if (chooseRef.current) chooseRef.current.value = '';
            if (cameraRef.current) cameraRef.current.value = '';
        }
    }

    function dropFile(event) {
        event.preventDefault();
        void handleFile(event.dataTransfer?.files?.[0]);
    }

    return (
        <div className={`image-upload-field ${className}`} onDragOver={(event) => event.preventDefault()} onDrop={dropFile}>
            <div className="image-upload-preview">
                {value ? <img src={value} alt={`${label} preview`} /> : <ImagePlus size={25} />}
            </div>
            <div className="image-upload-copy">
                <strong>{label}</strong>
                <small>{help}</small>
                <div className="image-upload-actions">
                    <button type="button" className="secondary-button small-button" onClick={() => chooseRef.current?.click()} disabled={busy}><ImagePlus size={14} /> Choose photo</button>
                    <button type="button" className="secondary-button small-button" onClick={() => cameraRef.current?.click()} disabled={busy}><Camera size={14} /> Use camera</button>
                    <span className="image-drop-hint"><UploadCloud size={14} /> or drop a file here</span>
                </div>
                {busy && <small role="status">Uploading image to DormDish…</small>}
                {error && <small className="image-upload-error" role="alert">{error}</small>}
            </div>
            <input ref={chooseRef} className="visually-hidden-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => void handleFile(event.target.files?.[0])} />
            <input ref={cameraRef} className="visually-hidden-file-input" type="file" accept="image/*" capture="environment" onChange={(event) => void handleFile(event.target.files?.[0])} />
        </div>
    );
}
