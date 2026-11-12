import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createApi, defaultApiUrl } from './api';

const KEYS = { apiUrl: 'aquaflow.apiUrl', session: 'aquaflow.session.v2', cache: 'aquaflow.cache.v2', branch: 'aquaflow.viewBranch' };
const POLL_MS = 8000;
const browserWindow = typeof window !== 'undefined' ? window : null;

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

/** Cross-platform message box (Alert's buttons don't work on web). */
export function notify(title, message) {
  if (Platform.OS === 'web' && browserWindow) browserWindow.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

export function confirm(title, message, confirmLabel = 'Yes') {
  if (Platform.OS === 'web' && browserWindow) return Promise.resolve(browserWindow.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

export function AppProvider({ children }) {
  const [booting, setBooting] = useState(true);
  const [apiUrl, setApiUrlState] = useState(defaultApiUrl());
  const [session, setSession] = useState(null); // { token, id, email, name, phone, role, branchId, mustChangePassword }
  const [data, setData] = useState(null);
  const [online, setOnline] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [viewBranchId, setViewBranchIdState] = useState(null); // admin's branch filter (null = all)
  const sessionRef = useRef(null);
  useEffect(() => { sessionRef.current = session; }, [session]);

  // The admin's branch filter is sent with every request; changing it rebuilds `api`, which restarts polling below.
  const api = useMemo(() => {
    const query = session?.role === 'admin' && viewBranchId ? { branchId: viewBranchId } : {};
    return createApi(apiUrl, session?.token, () => query);
  }, [apiUrl, session?.token, session?.role, viewBranchId]);

  useEffect(() => {
    (async () => {
      try {
        const [[, url], [, sess], [, cache], [, branch]] = await AsyncStorage.multiGet([KEYS.apiUrl, KEYS.session, KEYS.cache, KEYS.branch]);
        // A deployed website always talks to its own server; a saved address only matters in development.
        if (url && defaultApiUrl().startsWith('http://')) setApiUrlState(url);
        if (sess) setSession(JSON.parse(sess));
        if (cache) setData(JSON.parse(cache));
        if (branch) setViewBranchIdState(branch);
      } catch { /* first launch */ }
      setBooting(false);
    })();
  }, []);

  const saveSession = useCallback(async (sess) => {
    setSession(sess);
    if (sess) await AsyncStorage.setItem(KEYS.session, JSON.stringify(sess));
  }, []);

  const signOut = useCallback(async () => {
    const current = sessionRef.current;
    if (current) createApi(apiUrl, current.token).post('/api/auth/logout').catch(() => {});
    setSession(null);
    setData(null);
    setViewBranchIdState(null);
    await AsyncStorage.multiRemove([KEYS.session, KEYS.cache, KEYS.branch]);
  }, [apiUrl]);

  const refresh = useCallback(async () => {
    const sess = sessionRef.current;
    if (!sess || sess.mustChangePassword) return;
    try {
      const state = await api.get('/api/state');
      setData(state);
      setOnline(true);
      setLastSync(new Date());
      // Pick up role / branch changes made by the admin.
      if (state.me && (state.me.role !== sess.role || state.me.branchId !== sess.branchId || state.me.name !== sess.name)) {
        saveSession({ ...sess, ...state.me });
      }
      AsyncStorage.setItem(KEYS.cache, JSON.stringify(state)).catch(() => {});
    } catch (e) {
      if (e.status === 401) { signOut(); return; }
      if (e.status === 403 && /new password/i.test(e.message)) { saveSession({ ...sess, mustChangePassword: true }); return; }
      setOnline(false);
    }
  }, [api, signOut, saveSession]);

  // Keep data live: refresh on sign-in, every few seconds, and when the app returns to the foreground.
  useEffect(() => {
    if (!session || session.mustChangePassword) return undefined;
    // refresh() only sets state after the network request resolves, so this doesn't cascade renders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    let timer = setInterval(refresh, POLL_MS);
    const sub = AppState.addEventListener('change', (s) => {
      clearInterval(timer);
      if (s === 'active') { refresh(); timer = setInterval(refresh, POLL_MS); }
    });
    return () => { clearInterval(timer); sub.remove(); };
  }, [session, refresh]);

  const publicApi = useMemo(() => createApi(apiUrl, null), [apiUrl]);

  const signIn = useCallback(async (email, password, url) => {
    const base = (url || apiUrl).trim().replace(/\/$/, '');
    const res = await createApi(base, null).post('/api/auth/login', { email, password });
    if (base !== apiUrl) { setApiUrlState(base); AsyncStorage.setItem(KEYS.apiUrl, base).catch(() => {}); }
    const { token, ...user } = res;
    setData(null);
    await saveSession({ token, ...user });
    return user;
  }, [apiUrl, saveSession]);

  const signUp = useCallback((details, url) => createApi((url || apiUrl).trim().replace(/\/$/, ''), null).post('/api/auth/signup', details), [apiUrl]);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    await api.post('/api/auth/password', { currentPassword, newPassword });
    await saveSession({ ...sessionRef.current, mustChangePassword: false });
  }, [api, saveSession]);

  const setViewBranchId = useCallback((id) => {
    setViewBranchIdState(id || null);
    if (id) AsyncStorage.setItem(KEYS.branch, id).catch(() => {}); else AsyncStorage.removeItem(KEYS.branch).catch(() => {});
  }, []);

  /** Runs a mutation, shows any error, then refreshes everything. Resolves to the result or null. */
  const act = useCallback(async (fn, successMessage) => {
    try {
      const result = await fn(api);
      await refresh();
      if (successMessage) notify(successMessage);
      return result ?? true;
    } catch (e) {
      notify('Could not complete', e.message);
      return null;
    }
  }, [api, refresh]);

  const role = session?.role;
  const value = useMemo(() => ({
    booting, apiUrl, setApiUrl: setApiUrlState, session, data, online, lastSync, api, publicApi, refresh, signIn, signUp, signOut,
    changePassword, act, viewBranchId, setViewBranchId,
    isAdmin: role === 'admin',
    isStaff: role === 'staff' || role === 'admin', // the operations team (staff screens)
  }), [booting, apiUrl, session, data, online, lastSync, api, publicApi, refresh, signIn, signUp, signOut, changePassword, act, viewBranchId, setViewBranchId, role]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
