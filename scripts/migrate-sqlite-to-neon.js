import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { Pool } from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = process.env.DORMDISH_DB_PATH || path.join(root, 'server', 'data', 'dormdish.sqlite');
const connectionString = process.env.DATABASE_URL;
const tables = [
  'stores', 'users', 'products', 'orders', 'order_items', 'tracking_updates',
  'ratings', 'app_settings', 'group_orders', 'group_order_members',
  'group_order_items', 'rider_job_declines'
];

if (!connectionString) {
  console.error('Set DATABASE_URL to the Neon PostgreSQL connection string before running this migration.');
  process.exit(1);
}
if (!fs.existsSync(sourcePath)) {
  console.error(`SQLite source was not found at ${sourcePath}. Set DORMDISH_DB_PATH to your existing local database file.`);
  process.exit(1);
}

const sqlite = new Database(sourcePath, { readonly: true, fileMustExist: true });
const pool = new Pool({ connectionString, ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }, max: 2 });

try {
  const schema = fs.readFileSync(path.join(root, 'server', 'schema.postgres.sql'), 'utf8');
  await pool.query(schema);
  const targetUserCount = Number((await pool.query('SELECT COUNT(*)::int AS count FROM users')).rows[0].count);
  const targetStoreCount = Number((await pool.query('SELECT COUNT(*)::int AS count FROM stores')).rows[0].count);
  if ((targetUserCount > 0 || targetStoreCount > 0) && process.env.ALLOW_NONEMPTY_TARGET !== 'true') {
    throw new Error('The Neon database is not empty. Use a fresh Neon database/branch, or set ALLOW_NONEMPTY_TARGET=true only after backing up both databases and understanding possible ID conflicts.');
  }

  const existingTables = new Set(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const counts = {};
    for (const table of tables) {
      if (!existingTables.has(table)) continue;
      const sourceColumns = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      const targetColumnsResult = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table]);
      const targetColumns = new Set(targetColumnsResult.rows.map((c) => c.column_name));
      const columns = sourceColumns.filter((c) => targetColumns.has(c));
      if (!columns.length) continue;
      const rows = sqlite.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(',')} FROM "${table}"`).all();
      for (const row of rows) {
        const values = columns.map((column) => row[column] === undefined ? null : row[column]);
        const placeholders = values.map((_, index) => `$${index + 1}`).join(',');
        const quotedColumns = columns.map((c) => `"${c}"`).join(',');
        await client.query(`INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
      }
      counts[table] = rows.length;
    }

    for (const table of tables) {
      if (!existingTables.has(table)) continue;
      const sequence = await client.query("SELECT pg_get_serial_sequence($1, 'id') AS sequence_name", [table]);
      if (!sequence.rows[0]?.sequence_name) continue;
      const maxResult = await client.query(`SELECT COALESCE(MAX(id), 0)::bigint AS max_id FROM "${table}"`);
      const maxId = Number(maxResult.rows[0].max_id || 0);
      if (maxId > 0) {
        await client.query('SELECT setval($1::regclass, $2, true)', [sequence.rows[0].sequence_name, maxId]);
      } else {
        await client.query('SELECT setval($1::regclass, 1, false)', [sequence.rows[0].sequence_name]);
      }
    }
    await client.query('COMMIT');
    console.log('SQLite → Neon migration completed. Source row counts:', counts);
    console.log('Keep the SQLite file as a backup until you have verified logins, stores, products, orders, ratings, and group orders on the hosted API.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
} finally {
  sqlite.close();
  await pool.end();
}
