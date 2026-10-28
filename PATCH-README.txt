DormDish Expo API 404 fallback fix

Changed file:
  mobile/App.js

Why:
The Expo WebView was reporting `Request failed (404)` even though the API host was reachable. A server-level HTML 404 means the requested API route was not registered at that path; it is not an incorrect-password response. This patch retries a request without the `/api` prefix only when the original response looks like a framework-level HTML 404. If the server route exists but returns a JSON error (such as invalid credentials or a missing order), the patch does not retry it.

If both route formats return a framework-level 404, the login page shows an explicit backend route/deployment mismatch message instead of the generic `Request failed (404)`.

This patch does not alter Render variables, CORS settings, Vite build settings, or Neon data.

Apply:
1. Extract this ZIP into E:\DormDishMobile, keeping folders intact and overwriting mobile\App.js.
2. In PowerShell:

   cd E:\DormDishMobile\mobile
   npx expo start --clear

3. Fully close the old Expo Go session, scan the new QR code, then try login again.
