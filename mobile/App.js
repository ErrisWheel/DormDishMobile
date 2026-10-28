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
const API_ORIGIN = 'https://dormdish-api.onrender.com';

function getOrigin(value) {
  const match = String(value || '').trim().match(/^(https?:\/\/[^/?#]+)/i);
  return match ? match[1].replace(/\/+$/, '').toLowerCase() : '';
}

function normalizeWebsiteUrl(value) {
  const origin = getOrigin(value);
  // Expo must load the frontend host, never the API host or a stale deep link.
  if (!origin || origin === API_ORIGIN) return DEFAULT_WEBSITE_URL;
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

// Runs within the remote page. API fetches are delegated to React Native's
// network stack so a WebView-specific browser CORS/preflight failure cannot
// prevent the app from reaching its own API. Requests are restricted to the
// single known HTTPS API origin and /api/ path.
const INJECTED_APP_SCRIPT = String.raw`
(function () {
  try {
    var viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.setAttribute('name', 'viewport');
      (document.head || document.documentElement).appendChild(viewport);
    }
    viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');

    if (!document.getElementById('dormdish-expo-mobile-behavior')) {
      var style = document.createElement('style');
      style.id = 'dormdish-expo-mobile-behavior';
      style.textContent = [
        'html { -webkit-text-size-adjust: 100% !important; text-size-adjust: 100% !important; }',
        '@media (max-width: 850px) {',
        ' input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select { font-size: 16px !important; }',
        '}'
      ].join('\n');
      (document.head || document.documentElement).appendChild(style);
    }

    if (window.__dormdishNativeFetchInstalled) return true;
    if (!window.ReactNativeWebView || typeof window.ReactNativeWebView.postMessage !== 'function') return true;

    var originalFetch = window.fetch.bind(window);
    var pending = Object.create(null);
    window.__dormdishNativeFetchInstalled = true;
    window.__dormdishResolveNativeFetch = function (result) {
      var entry = pending[result && result.id];
      if (!entry) return;
      delete pending[result.id];
      clearTimeout(entry.timeout);
      try {
        if (result && result.transportError) {
          entry.resolve(new Response(JSON.stringify({ error: result.transportError }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          }));
          return;
        }
        var status = Number(result.status || 200);
        var responseBody = (status === 204 || status === 205 || status === 304) ? null : String(result.body || '');
        entry.resolve(new Response(responseBody, {
          status: status,
          headers: { 'Content-Type': String((result.headers && result.headers['content-type']) || 'application/json') }
        }));
      } catch (error) {
        entry.resolve(new Response(JSON.stringify({ error: 'Could not process the DormDish API response: ' + String(error && error.message || error) }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
    };

    window.fetch = function (input, init) {
      var requestUrl = typeof input === 'string' ? input : (input && input.url) || '';
      if (requestUrl.indexOf('https://dormdish-api.onrender.com/api/') !== 0) {
        return originalFetch(input, init);
      }

      var requestOptions = init || {};
      var method = String(requestOptions.method || 'GET').toUpperCase();
      var requestHeaders = {};
      var rawHeaders = requestOptions.headers || {};
      if (rawHeaders && typeof rawHeaders.forEach === 'function') {
        rawHeaders.forEach(function (value, key) { requestHeaders[String(key)] = String(value); });
      } else {
        Object.keys(rawHeaders).forEach(function (key) { requestHeaders[key] = String(rawHeaders[key]); });
      }

      var id = 'dd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
      return new Promise(function (resolve) {
        var timeout = setTimeout(function () {
          delete pending[id];
          resolve(new Response(JSON.stringify({ error: 'DormDish API request timed out after 60 seconds. Check whether the Render API service is awake and healthy.' }), {
            status: 504,
            headers: { 'Content-Type': 'application/json' }
          }));
        }, 60000);

        pending[id] = { resolve: resolve, timeout: timeout };
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'DORMDISH_NATIVE_API_FETCH',
            id: id,
            url: requestUrl,
            method: method,
            headers: requestHeaders,
            body: typeof requestOptions.body === 'string' ? requestOptions.body : null
          }));
        } catch (error) {
          clearTimeout(timeout);
          delete pending[id];
          resolve(new Response(JSON.stringify({ error: 'Could not hand the API request to the app: ' + String(error && error.message || error) }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
      });
    };
  } catch (error) {
    // Never stop the hosted website from rendering if an injection feature fails.
  }
  return true;
})();
true;
`;

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
    if (/^(https?:\/\/|mailto:|tel:)/i.test(target)) {
      Linking.openURL(target).catch(() => {});
    }
    return false;
  }, []);

  const openExternalWindow = useCallback((event) => {
    const target = event?.nativeEvent?.targetUrl;
    if (target) Linking.openURL(target).catch(() => {});
  }, []);

  const handleWebViewMessage = useCallback(async (event) => {
    let message;
    try {
      message = JSON.parse(event?.nativeEvent?.data || '{}');
    } catch {
      return;
    }
    if (message?.type !== 'DORMDISH_NATIVE_API_FETCH' || typeof message.id !== 'string') return;

    const targetUrl = String(message.url || '');
    const method = String(message.method || 'GET').toUpperCase();
    const targetPath = getPathname(targetUrl);
    const responsePayload = { id: message.id };

    // Never allow the WebView bridge to become an arbitrary native HTTP proxy.
    if (getOrigin(targetUrl) !== API_ORIGIN || !targetPath.startsWith('/api/') ||
        !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
      responsePayload.status = 403;
      responsePayload.body = JSON.stringify({ error: 'The app blocked an API request outside the approved DormDish API.' });
      responsePayload.headers = { 'content-type': 'application/json' };
    } else {
      try {
        const sourceHeaders = message.headers && typeof message.headers === 'object' ? message.headers : {};
        const safeHeaders = {};
        Object.keys(sourceHeaders).forEach((key) => {
          if (/^(accept|authorization|content-type)$/i.test(key)) safeHeaders[key] = String(sourceHeaders[key]);
        });

        const requestInit = { method, headers: safeHeaders };
        if (message.body != null && !['GET', 'HEAD'].includes(method)) requestInit.body = String(message.body);
        const response = await fetch(targetUrl, requestInit);
        responsePayload.status = response.status;
        responsePayload.body = await response.text();
        responsePayload.headers = { 'content-type': response.headers.get('content-type') || 'application/json' };
      } catch (error) {
        responsePayload.status = 503;
        responsePayload.transportError = `The app could not reach ${API_ORIGIN}. Render may be waking up or the API service may be unavailable. Native network error: ${String(error?.message || error)}`;
      }
    }

    if (webview.current) {
      const serialized = JSON.stringify(responsePayload);
      webview.current.injectJavaScript(
        `if (window.__dormdishResolveNativeFetch) { window.__dormdishResolveNativeFetch(${serialized}); } true;`
      );
    }
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
      setBuiltInZoomControls={false}
      setDisplayZoomControls={false}
      scalesPageToFit={false}
      textZoom={100}
      injectedJavaScriptBeforeContentLoaded={INJECTED_APP_SCRIPT}
      injectedJavaScript={INJECTED_APP_SCRIPT}
      onMessage={handleWebViewMessage}
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
