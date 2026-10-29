DormDish feature patch

1. Extract the ZIP into E:\DormDishMobile and preserve paths / overwrite included files.
2. From the project root, run: npm install
3. Then run: npm run build; npm test
4. Commit the updated package-lock.json produced by npm install if it changes. Do not commit .env, SMTP passwords, or email API keys.
5. Follow FEATURES-DEPLOYMENT.md to provision demo accounts and configure Render/Neon. On Render Free, configure Resend HTTPS email instead of Gmail SMTP because outbound SMTP ports are blocked.
6. In Render, the Web Service is https://dormdishmobile.onrender.com. The frontend Static Site uses https://dormdishmobile-static.onrender.com and VITE_API_URL=https://dormdishmobile.onrender.com/api.

For Render Free, use Resend HTTPS API as documented rather than SMTP. If you upgrade Render and choose Gmail SMTP, revoke the previously exposed app password and generate a fresh one; keep it only in Render environment variables.

GPS updates require location permission and the rider app to remain in the foreground. The rider confirms delivery with a camera proof photo. Photo bytes are stored in Neon BYTEA when DATABASE_URL is configured, or local SQLite BLOB in local development.


Recent UI fixes: superadmins can register stores and assign managers; store managers can no longer assign riders; riders can claim Ready for Pickup jobs from their own dashboard. Image URLs are normalized to the configured API host and failed previews use a visible fallback. Email delivery has an admin-only test button in Settings and supports Resend HTTPS API or SMTP on a host that permits it. Support messages route to SUPPORT_EMAIL; order statuses display as Order Received, Processed, In Kitchen, Ready for Pickup, On Delivery, and Delivered. Demo accounts remain seeded but are hidden from the login page.

For Render Free, set EMAIL_PROVIDER=resend, RESEND_API_KEY, EMAIL_FROM using a verified sending domain, SUPPORT_EMAIL, PUBLIC_WEB_URL, and PUBLIC_API_URL on the DormDishMobile Web Service. See FEATURES-DEPLOYMENT.md for exact values. Public signup creates customers only and saves their first address in the database; customers can manage multiple named addresses and delivery instructions.
