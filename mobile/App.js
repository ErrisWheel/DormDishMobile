import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { WebView } from 'react-native-webview';

const DEFAULT_WEBSITE_URL = 'https://dormdishmobile-static.onrender.com/';

// Avoid relying on the WHATWG URL global in the native JavaScript runtime.
// Some Hermes/runtime combinations can fail here and accidentally block every
// WebView navigation through onShouldStartLoadWithRequest.
function getOrigin(value) {
  const match = String(value || '').trim().match(/^(https?:\/\/[^/?#]+)/i);
  return match ? match[1].replace(/\/+$/, '').toLowerCase() : '';
}

function normalizeWebsiteUrl(value) {
  const origin = getOrigin(value);
  // A common configuration mistake is using the backend/API URL as the website.
  // For this project, the Expo shell must render the Static Site, not the API.
  if (!origin || origin === 'https://dormdish-api.onrender.com') {
    return DEFAULT_WEBSITE_URL;
  }
  // Always start at the origin root. Do not start inside a stale /api or
  // client-side route path inherited from a local .env file.
  return `${origin}/`;
}

function getPathname(value) {
  const text = String(value || '');
  const origin = getOrigin(text);
  if (!origin) return '';
  const remainder = text.slice(origin.length).split(/[?#]/, 1)[0];
  return remainder || '/';
}

const WEBSITE_URL = normalizeWebsiteUrl(
  process.env.EXPO_PUBLIC_WEBSITE_URL || DEFAULT_WEBSITE_URL
);
const WEBSITE_ORIGIN = getOrigin(WEBSITE_URL);
const BG = '#f7f8f5';
const TEXT = '#24251f';
const MUTED = '#85877f';
const ACCENT = '#e84335';

export default function App() {
  const webview = useRef(null);
  const recovered404Url = useRef('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => {
    recovered404Url.current = '';
    setLoadError('');
    setLoading(true);
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack && webview.current) {
        webview.current.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [canGoBack]);

  const shouldStartLoad = useCallback((request) => {
    const target = String(request?.url || '').trim();
    if (!target || target === 'about:blank') return true;
    if (/^(data:|blob:)/i.test(target)) return true;

    const targetOrigin = getOrigin(target);
    if (targetOrigin && targetOrigin === WEBSITE_ORIGIN) return true;

    // Open external URLs / phone / email links outside the app, but never block
    // same-site website navigation because URL parsing failed in the native VM.
    if (/^(https?:\/\/|mailto:|tel:)/i.test(target)) {
      Linking.openURL(target).catch(() => {});
    }
    return false;
  }, []);

  const openExternalWindow = useCallback((event) => {
    const target = event?.nativeEvent?.targetUrl;
    if (target) Linking.openURL(target).catch(() => {});
  }, []);

  if (!/^https?:\/\//i.test(WEBSITE_URL)) {
    return <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={BG} />
      <View style={styles.errorCard}>
        <Text style={styles.title}>DormDish</Text>
        <Text style={styles.message}>The website URL is invalid. Set EXPO_PUBLIC_WEBSITE_URL to your Render Static Site URL.</Text>
        <Pressable onPress={retry} style={styles.button}><Text style={styles.buttonText}>Retry</Text></Pressable>
      </View>
    </SafeAreaView>;
  }

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="dark-content" backgroundColor={BG} />
    <WebView
      key={reloadKey}
      ref={webview}
      source={{ uri: WEBSITE_URL }}
      style={styles.webview}
      originWhitelist={['http://*', 'https://*']}
      javaScriptEnabled
      domStorageEnabled
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      allowsBackForwardNavigationGestures
      setSupportMultipleWindows={false}
      startInLoadingState={false}
      cacheEnabled={false}
      onShouldStartLoadWithRequest={shouldStartLoad}
      onOpenWindow={openExternalWindow}
      onNavigationStateChange={(state) => setCanGoBack(Boolean(state.canGoBack))}
      onLoadStart={() => { setLoading(true); setLoadError(''); }}
      onLoadEnd={() => setLoading(false)}
      onError={(event) => {
        setLoading(false);
        const description = event?.nativeEvent?.description;
        setLoadError(description
          ? `Could not load DormDish: ${description}`
          : 'Could not load the DormDish website. Check your connection and the Render Static Site URL.');
      }}
      onHttpError={(event) => {
        const nativeEvent = event?.nativeEvent || {};
        const status = Number(nativeEvent.statusCode || 0);
        const failedUrl = String(nativeEvent.url || '');
        const isMainFrame = nativeEvent.isForMainFrame !== false;

        // If the web server returns a real 404 for an in-site route, return to
        // the known-good root once instead of leaving the Expo shell on Not Found.
        if (isMainFrame && status === 404 && getOrigin(failedUrl) === WEBSITE_ORIGIN) {
          const pathname = getPathname(failedUrl);
          if (pathname !== '/' && failedUrl !== recovered404Url.current) {
            recovered404Url.current = failedUrl;
            setLoadError('');
            setLoading(true);
            setReloadKey((value) => value + 1);
            return;
          }
        }

        if (isMainFrame && status >= 400) {
          setLoading(false);
          setLoadError(`DormDish returned HTTP ${status}. The app tried its home page if this was a route error; reload after checking the hosted site.`);
        }
      }}
      renderLoading={() => null}
    />
    {loading && !loadError ? <View pointerEvents="none" style={styles.loadingOverlay}>
      <View style={styles.brandMark}><Text style={styles.brandMarkText}>D</Text></View>
      <Text style={styles.title}>DormDish</Text>
      <Text style={styles.message}>Loading your campus dining app…</Text>
      <ActivityIndicator size="large" color={ACCENT} style={styles.spinner} />
    </View> : null}
    {loadError ? <View style={styles.errorOverlay}>
      <View style={styles.errorCard}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>D</Text></View>
        <Text style={styles.title}>DormDish couldn't load</Text>
        <Text style={styles.message}>{loadError}</Text>
        <Text style={styles.url}>{WEBSITE_URL}</Text>
        <Pressable onPress={retry} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable>
      </View>
    </View> : null}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  webview: { flex: 1, backgroundColor: BG },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: BG, padding: 28 },
  errorOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: BG, padding: 24 },
  errorCard: { width: '100%', maxWidth: 440, alignItems: 'flex-start', padding: 24, backgroundColor: '#fff', borderColor: '#e9ebe5', borderWidth: 1, borderRadius: 22 },
  brandMark: { width: 48, height: 48, borderRadius: 15, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  brandMarkText: { color: '#fff', fontSize: 26, fontWeight: '900' },
  title: { fontSize: 23, fontWeight: '800', color: TEXT, letterSpacing: -0.5 },
  message: { fontSize: 15, lineHeight: 22, color: MUTED, marginTop: 10 },
  spinner: { marginTop: 24 },
  url: { fontSize: 12, lineHeight: 18, color: MUTED, marginTop: 12 },
  button: { marginTop: 20, minHeight: 46, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: ACCENT, paddingHorizontal: 18 },
  buttonText: { color: '#fff', fontWeight: '800', fontSize: 15 }
});
