import { Capacitor } from '@capacitor/core';

const configuredBase = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, '');
// API
const nativeBase = configuredBase || 'https://dormdishmobile.onrender.com/api';
const apiBase = Capacitor.isNativePlatform()
    ? nativeBase
    : configuredBase || '/api';
const resolvedApiBase = apiBase.replace(/\/+$/, '');

// Images
export function resolveImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.startsWith('data:image/')) return raw;
    if (raw.startsWith('/images/')) return raw;

    try {
        const parsed = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'https://dormdishmobile-static.onrender.com');
        const match = parsed.pathname.match(/\/(?:api\/)?(media|product-images)\/([^/]+)\/?$/i);
        if (match) return `${resolvedApiBase.endsWith('/api') ? resolvedApiBase : `${resolvedApiBase}/api`}/${match[1]}/${match[2]}`;
        if (parsed.hostname.toLowerCase() === 'dormdish-api.onrender.com') {
            parsed.hostname = 'dormdishmobile.onrender.com';
            return parsed.toString();
        }
    } catch {
        return raw;
    }

    return raw;
}

// Session
export function getToken() {
    return localStorage.getItem('dormdish-token') || '';
}

export function saveSession(token, user) {
    localStorage.setItem('dormdish-token', token);
    localStorage.setItem('dormdish-user', JSON.stringify(user));
}

export function clearSession() {
    localStorage.removeItem('dormdish-token');
    localStorage.removeItem('dormdish-user');
}

// Requests
export async function apiRequest(path, options = {}) {
    const headers = {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        ...options.headers
    };

    let response;

    try {
        response = await fetch(`${apiBase}${path}`, {
            ...options,
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });
    } catch {
        throw new Error(`Cannot connect to DormDish API at ${apiBase}. Make sure the backend is running.`);
    }

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : null;

    if (!response.ok) {
        const error = new Error(payload?.error || `Request failed (${response.status}).`);
        error.status = response.status;
        throw error;
    }

    return payload;
}

// Formatting
export function money(value) {
    return `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
}

export function formatDate(value) {
    if (!value) return 'Not available';

    return new Date(value).toLocaleString('en-PH', {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
}

export function roleLabel(role) {
    return {
        superadmin: 'Super Admin',
        store_manager: 'Store Manager',
        customer: 'Customer',
        rider: 'Delivery Rider'
    }[role] || role;
}