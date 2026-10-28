DormDish Expo API + mobile zoom fix

Changed file:
  mobile/App.js

Changes:
- Routes requests to https://dormdish-api.onrender.com/api/* through React Native's native fetch from the WebView bridge. This can avoid a browser-WebView-only CORS/preflight failure while keeping requests restricted to the single DormDish API host and /api paths.
- Returns a readable network error in the login UI if the native request cannot reach the API, instead of hiding the actual network failure behind a generic fetch error.
- Keeps the website URL pointed at the Render Static Site; it does not alter Vite or Render environment values.
- Disables WebView pinch zoom and native zoom controls for a more app-like experience.
- Injects a mobile-only CSS rule for 16px form controls so iOS does not automatically zoom into small login inputs when they receive focus.
- Preserves the home-page fallback for a stale/internal 404 route.

Apply:
1. Extract the ZIP into E:\DormDishMobile, keeping folders intact and overwriting mobile\App.js.
2. In PowerShell:

   cd E:\DormDishMobile\mobile
   npm install
   npx expo install --fix
   npx expo start --clear

3. Open the new QR code with Expo Go and test login.

No Render settings, website source files, CORS environment variables, Vite configuration, backend files, or Neon database are changed by this patch. The bridge handles only requests to https://dormdish-api.onrender.com/api/; other web requests continue to use the normal WebView fetch.
