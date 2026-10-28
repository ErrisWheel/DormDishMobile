# DormDish setup (Windows + VS Code)

This patch keeps the existing Vite website, keeps SQLite for local development/tests, and adds a PostgreSQL path for Render + Neon. The Expo app is in `mobile/` and loads the hosted website through WebView for exact UI and workflow parity. Manager-uploaded product photos are stored as binary data in PostgreSQL on Neon (and as BLOBs in local SQLite mode).

## 1. Apply the patch

1. Make a backup of your current DormDish folder.
2. Extract the patch ZIP into the project root (`DormDishMobile-main`), keeping folder paths and allowing files to be overwritten.
3. Open the root folder in VS Code.
4. Copy `.env.example` to `.env` in PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

5. Set a private `JWT_SECRET` with at least 32 random characters. Do not share your `.env` or commit it.
6. After package.json has changed, run `npm install` (not `npm ci` the first time because the supplied lockfile must be regenerated for the new PostgreSQL dependency).
7. Start the current website/API locally with `npm run dev:web`; website: `http://localhost:5173`, API health: `http://localhost:4000/api/health`. Leave `DATABASE_URL` blank for local SQLite mode.

## 2. Neon PostgreSQL

1. Open your existing Neon project and copy its **pooled** PostgreSQL connection string from the Connect screen. Keep the username/password in a secret environment variable; do not put it in frontend variables.
2. Back up the current local SQLite database before migration. The default path is `server/data/dormdish.sqlite`; if your local DB is somewhere else, set `DORMDISH_DB_PATH` in `.env`.
3. If you need to preserve current local data, point `DATABASE_URL` in `.env` at an empty Neon database/branch, set `PUBLIC_API_URL` to the intended production API base URL, then run:

   ```powershell
   npm run migrate:neon
   ```

   The script creates the PostgreSQL schema and copies available records from SQLite. It refuses to import into a non-empty Neon database by default. Keep the SQLite file as a backup and verify important records after migration.
4. If you are starting fresh, leave `DATABASE_URL` blank locally and skip the migration script. The Render service will create the tables at startup.

## 3. Render API service

1. Push the project to a GitHub repository you control.
2. In Render, choose **New → Web Service**, connect the repository, and choose Node.
3. Use the repository root as the Root Directory, `npm install` as the Build Command, and `npm run server` as the Start Command. Set Health Check Path to `/api/health`.
4. In the service's **Environment** page, set these values:

   - `NODE_ENV` = `production`
   - `DATABASE_URL` = your Neon pooled connection string
   - `JWT_SECRET` = a new, strong random secret (different from local)
   - `CORS_ORIGIN` = the exact Render website URL, e.g. `https://dormdish-web.onrender.com`. Create the Static Site first (or copy its assigned URL), then use that exact origin here; do not leave this blank in production.
   - `INITIAL_ADMIN_NAME`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` = the first admin details if Neon has no active superadmin. Use an email you control and a password of at least 12 characters. Avoid demo credentials in production.
   - `SEED_SAMPLE_DATA` = `true` for a brand-new, empty Neon database if you want sample stores/products; set it to `false` if importing your existing SQLite data. Do not seed into the same database you plan to migrate into.
   - `PUBLIC_API_URL` = the full public API base URL, including `/api` (for example `https://dormdish-api.onrender.com/api`). After naming the backend service, copy its actual Render URL here. This is used to build stable product-image URLs.

5. Deploy. Open `https://YOUR-API.onrender.com/api/health`; it should return `ok: true` and `database: "postgresql"`.

**Database choice:** If migrating local data, run `npm run migrate:neon` against the empty Neon branch before the Render API starts for the first time. Do not enable sample seeding on a target you are using for a data import. For a brand-new Neon database, set the initial admin variables so you can sign in as Super Admin. For an imported database that already has an active superadmin, those variables can be left blank.

## 4. Render website

1. In Render, choose **New → Static Site** and connect the same repository.
2. Root Directory: repository root. Build Command: `npm install && npm run build`. Publish Directory: `dist`.
3. Add the build-time environment variable `VITE_API_URL` = `https://YOUR-API.onrender.com/api` (the actual Render API URL with `/api`). The updated API helper also appends `/api` if you accidentally omit it, but setting the complete value is still recommended. Then deploy/redeploy.
4. Keep `CORS_ORIGIN` on the API set to the full website URL, including `https://`. If you add a custom domain, update the allowed origin and redeploy the API.

## 5. Expo mobile app (Android + iOS) — exact UI parity

The Expo project is intentionally a WebView shell that loads the same deployed Vite website. This is what keeps the website, existing Capacitor Android app, and Expo iOS app visually and functionally aligned without maintaining a second implementation of every page. The React Native frontend is not separately rendered in this setup; the website must be reachable over the internet.

1. In `mobile/`, copy `.env.example` to `.env`. The default URL is `https://dormdishmobile-static.onrender.com`; change it if Render assigned your static site a different URL.
2. In PowerShell:

   ```powershell
   cd mobile
   npm install
   npx expo install --fix
   npx expo-doctor
   npx expo start --clear
   ```

3. Scan the QR code in Expo Go on your iPhone. Since the WebView loads the hosted website, Expo needs the website URL—not the API URL. The website itself uses its `VITE_API_URL` build-time setting to connect to the backend.
4. For local testing on a phone, set `EXPO_PUBLIC_WEBSITE_URL` to your PC's LAN IP and Vite port, for example `http://192.168.1.20:5173`. Keep the phone and PC on the same Wi-Fi. Vite's `/api` proxy routes calls to the local backend.
5. For an iOS cloud build from Windows, install EAS CLI (`npm install -g eas-cli`), sign in (`eas login`), then run from `mobile/`: `eas build:configure` and `eas build --platform ios`. The URL is embedded during bundling, so use the deployed website URL for production builds.

Important: this approach achieves 1:1 UI/workflow parity by reusing the website. If your course requires each mobile screen to be implemented as native React Native components and does not permit a WebView, a separate full React Native UI port is needed instead.

## 6. Product-photo storage in Neon

1. Set `PUBLIC_API_URL` on the Render API service to `https://YOUR-API.onrender.com/api` after Render gives you the real API URL.
2. Redeploy the API. Sign in as a store manager, open Products, choose a JPG/PNG/WEBP/AVIF image under 5 MB, upload it, then save the product.
3. The photo bytes are saved in the PostgreSQL `product_images.image_data` BYTEA column in Neon. `products.image_url` stores the public API URL used to retrieve those bytes. No Cloudinary account is needed. The current sample/legacy photos referenced as `/images/...` remain static website assets; newly uploaded product photos are stored inside Neon.

## 7. Verification before submitting

From the root folder, run:

```powershell
npm test
npm run build
```

Then verify sign-in, product edit/upload, customer checkout, manager status progression, rider online/accept/pickup/deliver, and super-admin account/store management using the hosted API. Payments remain demo/cash-on-delivery only; live GPS and actual rider payouts are not implemented.

## Notes and limitations

- If `DATABASE_URL` is set in the root `.env`, `npm run server` uses Neon. Leave it blank to use the existing local SQLite mode.
- Keep secrets server-only. Do not expose `DATABASE_URL` or `JWT_SECRET` via `VITE_*` or `EXPO_PUBLIC_*` variables.
- Expo intentionally loads the hosted website inside a WebView so it uses the exact same pages and business workflow as the web frontend and the existing Capacitor Android app. This means the hosted website must be reachable over the internet; it is not a separate native React Native UI.
- Existing local data is not included in the source ZIP because the SQLite database is local/ignored. Copy your actual `server/data/dormdish.sqlite` into your local project before migrating if you need those real records.
