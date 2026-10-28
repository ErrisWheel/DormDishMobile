import 'dotenv/config';

// Keep SQLite for local development and integration tests. Render uses Neon when
// DATABASE_URL is configured; both implementations expose the same /api routes.
if (process.env.DATABASE_URL?.trim()) {
    await import('./postgres-index.js');
} else {
    await import('./sqlite-index.js');
}
