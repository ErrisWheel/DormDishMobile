DormDish feature patch

1. Extract the ZIP into E:\DormDishMobile and preserve paths / overwrite included files.
2. From the project root, run: npm install
3. Then run: npm run build; npm test
4. Commit the updated package-lock.json produced by npm install. Do not commit .env or any SMTP password.
5. Follow FEATURES-DEPLOYMENT.md to provision demo accounts, configure Render/Neon, and configure Gmail SMTP.
6. In Render, the Web Service is https://dormdishmobile.onrender.com. The frontend Static Site uses https://dormdishmobile-static.onrender.com and VITE_API_URL=https://dormdishmobile.onrender.com/api.

The provided Gmail app password has been exposed in chat. Revoke it and create a fresh Google App Password; put it only into the Render Web Service SMTP_PASS environment variable.

GPS updates require location permission and the rider app to remain in the foreground. The rider confirms delivery with a camera proof photo. Photo bytes are stored in Neon BYTEA when DATABASE_URL is configured, or local SQLite BLOB in local development.


Recent UI fixes: superadmins can register stores and assign managers; store managers can no longer assign riders; riders can claim Ready for Pickup jobs from their own dashboard. Image URLs are normalized to the configured API host and failed previews use a visible fallback. Gmail SMTP has an admin-only test button in Settings. Support messages route to SUPPORT_EMAIL using SMTP; order statuses display as Order Received, Processed, In Kitchen, Ready for Pickup, On Delivery, and Delivered. Demo accounts remain seeded but are hidden from the login page.

Set SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, SUPPORT_EMAIL, PUBLIC_WEB_URL, and PUBLIC_API_URL on the DormDishMobile Web Service. See FEATURES-DEPLOYMENT.md for exact values.
