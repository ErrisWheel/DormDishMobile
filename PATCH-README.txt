DormDish Expo-only Not Found fix

Changed file:
  mobile/App.js

What this fixes:
- Removes the native WebView navigation guard's dependency on the JavaScript URL constructor. On a native runtime where URL parsing fails, that guard could return false and block website loads/navigation.
- Normalizes EXPO_PUBLIC_WEBSITE_URL to the host root so a stale /login or /api path won't become the initial page.
- Falls back once to the root if a same-site route returns a real HTTP 404.
- Disables WebView caching while testing so an old not-found response isn't reused.
- If the Expo environment was accidentally pointed at https://dormdish-api.onrender.com, it uses the known working website https://dormdishmobile-static.onrender.com/ instead.

No Render environment, Vite configuration, CORS setting, backend, or database file is changed.

Apply:
1. Extract this ZIP into the DormDish project root, preserving folders and overwriting mobile/App.js.
2. In PowerShell:

   cd E:\DormDishMobile\mobile
   npm install
   npx expo install --fix
   npx expo start --clear

3. Open the new QR code in Expo Go. Make sure you run Expo from the mobile folder, not the project root.

Expo uses the hosted website inside a WebView. The startup URL is the website root:
  https://dormdishmobile-static.onrender.com/
