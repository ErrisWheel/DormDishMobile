import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { resolveImageUrl } from '../lib/api.js';

// Images
export function MediaImage({ src, alt = '', className = '', fallbackText = '', fallbackSrc = '/images/hero-food.png', ...props }) {
    const normalizedSrc = resolveImageUrl(src);
    const normalizedFallback = resolveImageUrl(fallbackSrc);
    const [failed, setFailed] = useState(false);
    const [fallbackFailed, setFallbackFailed] = useState(false);

    useEffect(() => {
        setFailed(false);
        setFallbackFailed(false);
    }, [normalizedSrc]);

    if (!normalizedSrc || failed) {
        if (fallbackText) {
            return <span className={`media-image-fallback ${className}`.trim()} aria-label={alt || 'Image unavailable'}>{fallbackText}</span>;
        }
        if (normalizedFallback && !fallbackFailed) {
            return <img {...props} className={className} src={normalizedFallback} alt={alt} onError={() => setFallbackFailed(true)} />;
        }
        return <span className={`media-image-placeholder ${className}`.trim()} aria-label={alt || 'Image unavailable'}><ImageOff size={20} /></span>;
    }

    return <img {...props} className={className} src={normalizedSrc} alt={alt} onError={() => setFailed(true)} />;
}
