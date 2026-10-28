DormDish website API + Expo parity patch

Files to overlay into the existing DormDish project root:
- src/lib/api.js: guarantees the API base ends in /api; uses VITE_API_URL for both browser and Capacitor builds.
- server/postgres-index.js: normalizes CORS_ORIGIN values and compares origin-only values, so an accidental trailing slash or query mark does not break matching.
- mobile/App.js: replaces the separate, partial native screens with an Expo WebView shell loading the same deployed Vite website. This is the deliberate choice for 1:1 UI/workflow parity.
- mobile/package.json / mobile/app.json: use the SDK 58-compatible react-native-webview package and remove now-unused native image-picker/secure-store plugins.
- mobile/.env.example: uses the actual Render Static Site URL as the default.

RENDER SETTINGS
Static Site environment:
  VITE_API_URL=https://dormdish-api.onrender.com/api

Web Service environment:
  CORS_ORIGIN=https://dormdishmobile-static.onrender.com
  DATABASE_URL=<your Neon pooled connection string>
  JWT_SECRET=<your random secret>

The API URL must contain /api. CORS_ORIGIN must be the static website origin, with no /api, question mark, or trailing slash. Change the hostname if your Render services have different actual URLs.

AFTER OVERLAYING
From the project root, run npm install, npm run build, then commit and push. Redeploy both Render services. In E:\DormDishMobile\mobile, copy .env.example to .env, run npm install, npx expo install --fix, npx expo-doctor, and npx expo start --clear.

Note: this Expo app is a WebView wrapper on purpose. It runs the actual website inside an Expo-built app, which means the Vite website is the single source of UI and workflow. It requires internet access when the website is hosted on Render. If the professor specifically requires a fully native React Native UI (not a WebView), this option will not meet that stricter requirement; exact parity would then require porting every web screen and interaction into React Native components.
