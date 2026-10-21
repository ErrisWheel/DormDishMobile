import { Capacitor } from '@capacitor/core';

const configuredBase = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, '');
const defaultBase = Capacitor.isNativePlatform() ? 'http://10.0.2.2:4000/api' : '/api';
const apiBase = configuredBase || defaultBase;

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

export async function apiRequest(path, options = {}) {
    const headers = {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        ...options.headers
    };
    const response = await fetch(`${apiBase}${path}`, {
        ...options,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : null;

    if (!response.ok) {
        const error = new Error(payload?.error || `Request failed (${response.status}).`);
        error.status = response.status;
        throw error;
    }

    return payload;
}

export function money(value) {
    return `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
}

export function formatDate(value) {
    if (!value) {
        return 'Not available';
    }

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
