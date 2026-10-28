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

// Hosting the same website inside Expo is the only dependable way to keep its UI,
// navigation, forms, and workflows identical without maintaining a second UI implementation.
const WEBSITE_URL = String(
  process.env.EXPO_PUBLIC_WEBSITE_URL || 'https://dormdishmobile-static.onrender.com'
).trim().replace(/\/+$/, '');
const BG = '#f7f8f5';
const TEXT = '#24251f';
const MUTED = '#85877f';
const ACCENT = '#e84335';

export default function App() {
  const webview = useRef(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => {
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
    const target = request?.url || '';
    if (!target || target === 'about:blank') return true;
    try {
      const url = new URL(target);
      const siteOrigin = new URL(WEBSITE_URL).origin;
      if (url.origin === siteOrigin || ['data:', 'blob:'].includes(url.protocol)) return true;
      if (['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) {
        Linking.openURL(target).catch(() => {});
      }
      return false;
    } catch {
      return false;
    }
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
      cacheEnabled
      onShouldStartLoadWithRequest={shouldStartLoad}
      onOpenWindow={openExternalWindow}
      onNavigationStateChange={(state) => setCanGoBack(Boolean(state.canGoBack))}
      onLoadStart={() => { setLoading(true); setLoadError(''); }}
      onLoadEnd={() => setLoading(false)}
      onError={(event) => {
        setLoading(false);
        setLoadError(event?.nativeEvent?.description || 'Could not load the DormDish website. Check your connection and the Render Static Site URL.');
      }}
      onHttpError={(event) => {
        if (event?.nativeEvent?.isForMainFrame && event.nativeEvent.statusCode >= 400) {
          setLoading(false);
          setLoadError(`The DormDish website returned HTTP ${event.nativeEvent.statusCode}. Check that the Render Static Site is deployed.`);
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
