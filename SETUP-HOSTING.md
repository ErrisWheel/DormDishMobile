# DormDish setup (Windows + VS Code)

This patch keeps the existing Vite website, keeps SQLite for local development/tests, and adds a PostgreSQL path for Render + Neon. The Expo app is in `mobile/` and uses the same hosted API. Manager-uploaded product photos are stored as binary data in PostgreSQL on Neon (and as BLOBs in local SQLite mode).

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
3. Add the build-time environment variable `VITE_API_URL` = `https://YOUR-API.onrender.com/api` (the actual Render API URL with `/api`). Then deploy/redeploy.
4. Keep `CORS_ORIGIN` on the API set to the full website URL, including `https://`. If you add a custom domain, update the allowed origin and redeploy the API.

## 5. Expo mobile app (Android + iOS)

The Expo project is separate from the existing Vite website and existing Capacitor Android project: `mobile/`. It signs in and loads data through the same API. The mobile project targets Expo SDK 58 to match the Expo Go version shown in your iPhone screenshot. Expo requires the project SDK to match Expo Go; see https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/.

1. Open a second VS Code window with the `mobile` folder.
2. Copy `mobile/.env.example` to `mobile/.env` and replace the example with your real API URL: `EXPO_PUBLIC_API_URL=https://YOUR-API.onrender.com/api` and `EXPO_PUBLIC_WEBSITE_URL=https://YOUR-WEBSITE.onrender.com`. The second variable resolves existing `/images/...` assets for the native app. For local Android emulator testing use API `http://10.0.2.2:4000/api` and website `http://10.0.2.2:5173`; for an iOS simulator on a Mac use API `http://localhost:4000/api` and website `http://localhost:5173`. A physical iPhone on another network should use the deployed Render URLs.
3. Run these PowerShell commands:

   ```powershell
   npm install
   npx expo install --fix
   npx expo-doctor
   npx expo start --clear
   ```

4. Use Android Studio's emulator for Android testing. To generate/open native Android project files when needed, run `npx expo prebuild --platform android`, then open `mobile/android` in Android Studio. The existing root-level `android/` folder belongs to the previous Capacitor app; do not confuse the two.
5. For iOS cloud builds from Windows, install EAS CLI with `npm install -g eas-cli`, sign in using `eas login`, then from `mobile/` run `eas build:configure` and `eas build --platform ios`. Follow EAS prompts to create/sign with Apple credentials. Set both `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_WEBSITE_URL` in the EAS environment/build profile too; mobile `EXPO_PUBLIC_*` variables are embedded at build time.
6. For an App Store release, you will need the appropriate Apple Developer Program membership. An iOS build file is not the same as having an App Store-published app. Without an iPhone or Mac, use EAS's remote build and available remote simulation/testing options; you may still need an iPhone/TestFlight tester to verify real-device behavior.

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
- The initial Expo app has customer browsing/checkout/orders, rider availability/job flow, manager product/order basics, and admin listings. The existing website remains the full management experience; mobile role screens are an additional native frontend and will need visual/functional parity review before public release.
- Existing local data is not included in the source ZIP because the SQLite database is local/ignored. Copy your actual `server/data/dormdish.sqlite` into your local project before migrating if you need those real records.
