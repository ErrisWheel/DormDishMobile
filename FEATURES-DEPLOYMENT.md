# DormDish feature deployment notes

This patch keeps the existing React/Vite screens and adds superadmin store creation and manager assignment, rider-claimed pickup jobs, shared GPS, rider photo proof, database-backed images, demo-account provisioning, and email verification.

## 1. Install dependencies and commit the lockfile

From PowerShell in the repository root:

```powershell
npm install
npm run build
npm test
```

The project now includes `pg` and `nodemailer`. The original lockfile may not list these server dependencies yet; `npm install` regenerates `package-lock.json`. Commit that updated lockfile with `package.json`. Use `npm install`, not `npm ci`, until the lockfile has been regenerated successfully.

## 2. Render services

There are two separate Render services:

### Web Service: `DormDishMobile`

- URL: `https://dormdishmobile.onrender.com`
- Build command: `npm install`
- Start command: `npm run server`
- `DATABASE_URL`: your Neon PostgreSQL connection string
- `JWT_SECRET`: a random secret at least 24 characters long
- `PUBLIC_API_URL`: `https://dormdishmobile.onrender.com/api`
- `PUBLIC_WEB_URL`: `https://dormdishmobile-static.onrender.com`
- `CORS_ORIGIN`: `https://dormdishmobile-static.onrender.com` (no trailing slash)

For Gmail verification, set these on the Web Service only:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=dormdishdelivery@gmail.com
SMTP_PASS=<a newly generated Google App Password>
SMTP_FROM=DormDish Delivery <dormdishdelivery@gmail.com>
```

Do not reuse an app password that was pasted into a chat or otherwise exposed. Revoke that Google App Password, create a replacement with Google 2-Step Verification enabled, and enter the replacement directly in Render's environment settings. Do not put it in this ZIP, `.env.example`, or GitHub.

### Static Site: `DormDishMobile-Static`

- Build command: `npm install && npm run build`
- Publish directory: `dist`
- `VITE_API_URL`: `https://dormdishmobile.onrender.com/api`

Because Vite embeds this setting at build time, changing `VITE_API_URL` requires a new Static Site deployment. Keep the existing SPA rewrite `/*` -> `/index.html` so the email link `/?verify=...` loads the React verification page.

## 3. Put demo accounts in Neon

The Postgres backend applies additive schema changes on startup, including the user verification columns and the `uploaded_media`, `rider_locations`, and `delivery_proofs` tables. To seed the classroom demo accounts into an already-populated Neon database:

1. In the **DormDishMobile Web Service** environment, set `SEED_DEMO_ACCOUNTS=true`.
2. Optionally set explicit passwords with `DEMO_SUPERADMIN_PASSWORD`, `DEMO_MANAGER_PASSWORD`, `DEMO_CUSTOMER_PASSWORD`, and `DEMO_RIDER_PASSWORD`. If omitted, the code uses the sample values in `.env.example`.
3. Deploy or restart the Web Service once and check `/api/health` for build `dormdish-live-gps-proof-verification-2026-10-29` and the `demo-account-seeding` feature.
4. **Immediately set `SEED_DEMO_ACCOUNTS=false` and redeploy.** While enabled, startup deliberately resets password hashes for the known `@dormdish.test` demo accounts so the specified demo passwords work. Do not leave demo credentials enabled on a public app longer than your demo requires.

The default demo emails are:

| Role | Email | Password environment variable |
|---|---|---|
| Super Admin | `superadmin@dormdish.test` | `DEMO_SUPERADMIN_PASSWORD` |
| Store Managers | `manager.alpha@dormdish.test`, `manager.beta@dormdish.test`, `manager.gamma@dormdish.test` | `DEMO_MANAGER_PASSWORD` |
| Customer | `customer@dormdish.test` | `DEMO_CUSTOMER_PASSWORD` |
| Rider | `rider@dormdish.test` | `DEMO_RIDER_PASSWORD` |

The managers are assigned to the first three active stores ordered by ID, and the demo rider to the first active store. The routine does not reset the separate `INITIAL_ADMIN_EMAIL` account. When starting from an empty database, demo seeding also creates sample stores/products; with existing stores, it adds or updates demo user accounts against those existing stores.

## 4. Rider GPS and delivery proof

1. The store manager moves an order through `Confirmed`, `Preparing`, and `Ready for Pickup`. The order remains unassigned until a rider claims it. Store staff cannot assign a rider.
2. The assigned rider taps **Confirm pickup & start GPS** after physically collecting the order.
3. While the rider dashboard stays active, the phone/browser's Geolocation API reports coordinates to `POST /api/orders/:id/location`. The customer order screen fetches the same saved coordinate every four seconds and shows it on the embedded map with an update time.
4. The rider taps **Take delivery proof photo** after handoff; the mobile device opens its camera capture UI. The image is uploaded to the backend, and only then does the order change to `Delivered`.

The server rejects store-manager attempts to mark an order `Out for Delivery` or `Delivered`; it also rejects rider delivery completion unless the assigned rider uploads a proof photo. If the rider denies location permission, the customer can still see a previously saved point but won't receive new coordinates. The operating system may pause GPS events when the app is backgrounded or closed; this patch is foreground tracking, not an always-on background location service.

In Expo, the WebView explicitly enables geolocation. The mobile app config declares iOS location/camera/photo-library usage strings and Android location/camera permissions. After changing native app permissions, rebuild the native app for a production/EAS build; an Expo Go session uses Expo Go's own native permission descriptions.

## 5. Product/store/profile photos

The product, store, and profile controls offer file selection and camera capture; desktop controls also accept drag-and-drop. Delivery proof uses the rider camera-capture control. The endpoint validates the MIME type and a 5 MB limit. Photo bytes are stored in PostgreSQL `BYTEA` (Neon) or SQLite `BLOB` in local mode; the corresponding product/store/profile row keeps a served API image URL. The backend does not depend on Render's ephemeral filesystem.

## 6. Email verification

- Logged-in users in every role can tap **Verify email** beside their role, or open their account profile. Customers can also open verification from **My profile**.
- The backend emails a random single-use token. Only the SHA-256 hash is stored in the database. The token expires after 24 hours, and resend requests are throttled to once per minute.
- The email link opens the static-site React page at `/?verify=...`, which calls `GET /api/auth/verify` to verify the account.
- If the verification button returns a 503, check `SMTP_USER`, `SMTP_PASS`, and `PUBLIC_WEB_URL`. If sending returns 502, review the Web Service logs for the SMTP error code. Gmail App Password spaces are stripped automatically; the password must still be a valid, current App Password for `SMTP_USER`.

This adds verification and a visible verified state; it does not block sign-in or orders for unverified accounts.

## 7. Health and smoke checks

Open `https://dormdishmobile.onrender.com/api/health`. Confirm:

- `database` is `postgresql`
- `build` is `dormdish-live-gps-proof-verification-2026-10-29`
- `features` contains `demo-account-seeding`, `email-verification`, `image-upload`, `rider-live-gps`, and `rider-delivery-proof`

Then test: demo login; upload a small profile image; request a verification email; move a test order to Ready for Pickup; accept it with a rider; confirm pickup with location enabled; open the customer order from another session; submit rider delivery proof and confirm that the customer sees Delivered plus the proof photo.
