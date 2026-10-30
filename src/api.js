import Constants from 'expo-constants';
import { Platform } from 'react-native';

const API_PORT = 4000;

/**
 * Best guess for where the AquaFlow server runs during development:
 * the same machine that serves the Expo bundle (works for Expo Go on a phone on the same Wi-Fi).
 */
export function defaultApiUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:${API_PORT}`;
  if (Platform.OS === 'android') return `http://10.0.2.2:${API_PORT}`; // Android emulator -> host machine
  return `http://localhost:${API_PORT}`;
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createApi(baseUrl, token) {
  async function request(method, path, body) {
    let res;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
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
      throw new ApiError(0, `Can't reach the AquaFlow server at ${baseUrl}. Check it is running and on the same network.`);
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
