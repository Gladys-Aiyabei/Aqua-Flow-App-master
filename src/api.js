import Constants from 'expo-constants';
import { Platform } from 'react-native';

const API_PORT = 4000;

/**
 * Where the AquaFlow API lives:
 * 1. EXPO_PUBLIC_API_URL if set at build time (use this for phone builds, e.g. https://aquaflowkenya.netlify.app).
 * 2. On the deployed website: the same site (Netlify serves the API at /api).
 * 3. In development: the computer running the Expo dev server, port 4000.
 */
export function defaultApiUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');
  if (Platform.OS === 'web' && typeof window !== 'undefined' && !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
    return window.location.origin;
  }
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:${API_PORT}`;
  if (Platform.OS === 'android') return `http://10.0.2.2:${API_PORT}`; // Android emulator -> host machine
  return `http://localhost:${API_PORT}`;
}

/** True when the app is a development build (shows the server address field). */
export const isDevBuild = typeof __DEV__ !== 'undefined' && __DEV__;

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** `query` is an optional function returning extra query params (e.g. the admin's branch filter). */
export function createApi(baseUrl, token, query) {
  async function request(method, path, body) {
    let res;
    const extra = query?.() ?? {};
    const qs = Object.entries(extra).filter(([, v]) => v).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const fullPath = qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      res = await fetch(`${baseUrl.replace(/\/$/, '')}${fullPath}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch {
      throw new ApiError(0, "Can't reach the AquaFlow server. Check your internet connection and try again.");
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, json.error || `Request failed (${res.status})`);
    return json;
  }
  return {
    get: (p) => request('GET', p),
    post: (p, b = {}) => request('POST', p, b),
    patch: (p, b = {}) => request('PATCH', p, b),
    del: (p) => request('DELETE', p),
  };
}
