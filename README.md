# DormDish Mobile

DormDish is a React, Vite, Capacitor/Expo WebView, and Express app. It supports SQLite for local development and Neon PostgreSQL when `DATABASE_URL` is configured for Render. Production rider tracking uses the phone browser/WebView Geolocation API; email verification uses Nodemailer + SMTP. Payments remain demo-only and no money is processed.

## Project structure

```text
DormDishMobile/
    src/
        App.jsx
        lib/api.js
        components/LoginPage.jsx
        pages/customer/
        pages/manager/ManagerDashboard.jsx
        pages/admin/AdminDashboard.jsx
        pages/rider/RiderDashboard.jsx
        styles.css
        role-styles.css
        enhancements.css
    server/
        index.js
        auth.js
        database.js
        data/
    scripts/reset-database.js
    tests/api.test.js
    android/
```

The API routes enforce role permissions on the server, not only in the UI. SQLite creates its tables and sample records automatically when the API starts for the first time. The local database file is `server/data/dormdish.sqlite` and is ignored by Git.

## Requirements

- Node.js 22 LTS or newer with npm
- Internet access for the first `npm install` so npm can fetch dependencies
- Android Studio only if you want to launch the native Android project

## Run on Windows

1. Open the `DormDishMobile` root folder in VS Code.
2. Copy `.env.example` to `.env` in PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Open `.env` and replace `JWT_SECRET` with a long random value. Leave `VITE_API_URL` blank for the desktop web app. The example value is only suitable for local classroom development.
4. Install dependencies:

   ```powershell
   npm install
   ```

   Use `npm install` for this first setup rather than `npm ci`; the lockfile from the original frontend prototype needs to be regenerated to include the added local API dependencies. Commit the updated `package-lock.json` after installation succeeds.

5. Start the full development workflow:

   ```powershell
   npm run dev
   ```

   This starts the SQLite API and Vite server, then attempts to launch DormDish in the first configured Android emulator using Capacitor's live development server. Keep the terminal open while debugging.

6. The browser preview remains available at `http://localhost:5173`, and the API health endpoint is `http://localhost:4000/api/health`.

The app in the Android emulator uses `http://10.0.2.2:5173` for live React changes and `http://10.0.2.2:4000/api` for local API requests. The normal `capacitor.config.json` remains pointed at the built web assets; `capacitor.config.dev.json` is only used by the development launcher. The API listens on `0.0.0.0:4000`. For browser-only work, run `npm run dev:web`.

## Seeded test accounts

All accounts use hashed passwords in SQLite. These are local classroom credentials, not production credentials.

| Role | Email | Password | Assigned store |
|---|---|---|---|
| Super Admin | `superadmin@dormdish.test` | `Admin123!` | System-wide |
| Store Manager 1 | `manager.alpha@dormdish.test` | `Manager123!` | Store Alpha |
| Store Manager 2 | `manager.beta@dormdish.test` | `Manager123!` | Store Beta |
| Store Manager 3 | `manager.gamma@dormdish.test` | `Manager123!` | Store Gamma |
| Customer | `customer@dormdish.test` | `Customer123!` | Customer account |
| Delivery Rider | `rider@dormdish.test` | `Rider123!` | Store Alpha |

The sign-in page includes buttons to autofill each demo account.

## Implemented permissions and flows

- Super Admin manages accounts, store registrations and manager assignments, delivery rider associations through user management, general settings, and rating visibility. Order APIs explicitly deny Super Admin access, and the product write APIs deny Super Admin access.
- Store Managers only manage products, orders, ratings, riders, and tracking for their assigned store. Product create, edit, and delete endpoints only allow Store Managers.
- Customers browse active stores ordered by database-calculated average rating, browse store products, order available stock, view their order history, follow ETA and tracking events, and rate a store after delivery.
- Riders only see orders assigned to their rider account for their assigned store. Once they confirm physical pickup, the app reads their device GPS, writes shared coordinates to the backend, and the customer order map refreshes every few seconds while delivery is active. Only the assigned rider can finish the order, and the backend requires a delivery proof photo.
- Order placement and cancellation update stock in SQLite. Orders retain item snapshots so historic order information remains readable.
- Store location links open Google Maps externally. Order confirmation, order history, and rider deliveries include a Store-to-delivery route link. Google Maps calculates the driving distance and travel time for the entered destination; no paid Maps API or fake GPS is used. Store Alpha uses the provided Maps link.
- Rider GPS is device-derived and depends on location permission, network connectivity, and the app staying active. Customers see the last saved point and timestamp when live updates stop; location updates are not guaranteed while the app is closed or background-suspended. ETA remains an estimate.
- Payments are demo-only and no money is processed.

## Android emulator debugging

Install Android Studio, Android SDK Platform-Tools, and create at least one Android Virtual Device in Device Manager. You can leave the emulator stopped: `npm run dev` attempts to start the first configured AVD automatically. If automatic launch is not available, start the emulator manually and run `npm run dev:android` in a second terminal while the API and Vite server remain running.

To use an emulator with the already-running API and Vite server, run `npm run dev:android` in a second terminal. To run only the website and API in the browser, run `npm run dev:web`. The mobile app uses a dedicated Capacitor development config pointing to Vite over `10.0.2.2`, while `http://localhost:5173` remains available on the development computer.

For a production-style packaged build instead of the live development server, run `npm run build`, `npx cap sync android`, and `npx cap open android`, then launch it from Android Studio. The development manifest allows cleartext HTTP for the local classroom API. Do not use that configuration for a public production deployment. Capacitor 8 uses newer Android build tools, so use an Android Studio version compatible with the AGP/Gradle versions configured in the project.

For a physical phone, set `VITE_API_URL` in `.env` to the computer's LAN IP, for example `http://192.168.1.20:4000/api`, then rebuild and sync the Android app. The phone and computer must be on the same Wi-Fi, and the computer firewall must allow the local API port.

## Tests

Run the API integration checks after `npm install` and after copying `.env.example` to `.env` for normal development:

```powershell
npm test
```

The tests launch an isolated API process with a temporary SQLite database and check seeded ratings, role restrictions, manager product scope, authentication, order progress, ETA, tracking persistence, rider access, and customer ratings. The test database is deleted at the end.

## Reset sample data

Stop the development server first, then run:

```powershell
npm run db:reset
npm run dev
```

The reset command deletes the default local SQLite database files. The next API startup recreates the schema, accounts, stores, sample products, sample ratings, and demo delivery. It does not reset browser-local favorites or a saved cart; clear the browser's site data if you also want to reset those.

## Operational notes

- The SQLite database is local to the machine running the API. In Render production, `DATABASE_URL` selects Neon PostgreSQL, where account, order, tracking, and uploaded image data are stored.
- The default store names, ratings, products, prices, and customer addresses are demo records and can be edited through the provided manager/admin screens.
- `VITE_API_URL` can be left blank for Vite web development and Android emulator use. Vite proxies `/api` to the local API while developing on desktop.
- The original frontend-only demo screens have been replaced by role-specific data-backed screens. Browser storage is still used only for cart, favorites, theme preference, and the customer's usual delivery address.


## Render and Neon deployment

See [FEATURES-DEPLOYMENT.md](FEATURES-DEPLOYMENT.md) for the exact Render environment variables, one-time demo-account provisioning, email verification setup, and the shared GPS/photo-proof flow. Do not put a Gmail app password in source code, `.env.example`, or GitHub.
