import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const configuredPath = process.env.DORMDISH_DB_PATH;
const databasePath = configuredPath
    ? path.resolve(configuredPath)
    : path.join(directory, '..', 'server', 'data', 'dormdish.sqlite');

for (const filePath of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
    if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
    }
}

process.stdout.write('DormDish SQLite database files removed. Restart the API to recreate the database and sample data.\n');
