import 'dotenv/config';

// API entry
if (process.env.DATABASE_URL?.trim()) {
    await import('./postgres-index.js');
} else {
    await import('./sqlite-index.js');
}
