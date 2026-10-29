DormDish Mobile-width + account-deletion patch

INSTALL
1. Back up your current project folder.
2. Extract this ZIP into the root of E:\DormDishMobile (the same folder that contains package.json).
3. Allow the listed files to overwrite existing files and add the new src/components/DeleteAccountPanel.jsx file.
4. Run `npm test` and `npm run build` locally.
5. Commit and push the changed files to the GitHub branch Render deploys. Both the backend Web Service and frontend Static Site need the update.

CHANGES
- Fixes phone-width overflow, including the email-verification page, narrow headers, and non-shrinking layouts. The page should no longer have a body-level horizontal slider at iPhone-sized widths.
- Adds a Delete account section to the customer profile and non-customer account profile.
- Requires a separate confirmation step and the user to type DELETE before the action is enabled.
- Adds authenticated DELETE /api/auth/account and /auth/account endpoints for both PostgreSQL (Neon) and SQLite.
- Invalidates the current session, removes saved addresses and profile media, removes saved group-order participation, redacts delivery addresses and order notes, anonymizes ratings/tracking attribution, and makes the account inactive with a random inaccessible password and replacement email.
- Keeps historic order rows linked to an anonymized placeholder so store/order operations and historical records remain consistent. Active deliveries assigned to a deleting rider are returned to the pickup queue. A sole active superadmin is prevented from deleting their own account to avoid locking out the system.
- Adds an API regression test for own-account deletion and old-session invalidation.

No database migration is needed; this patch uses existing schema fields and tables.

VALIDATION NOTE
Source syntax checks passed for frontend JSX/JavaScript, backend JavaScript, tests, and CSS. The full build/test commands could not run in this packaging environment because the extracted node_modules tree is missing platform-specific optional binaries and the dotenv package. Run them in the existing local project install before deploying.
