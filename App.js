import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/AppContext';
import { colors } from './src/theme';
import { pct } from './src/format';
import { AppHeader, Segmented } from './src/components/ui';
import TabBar from './src/components/TabBar';
import LoginScreen from './src/screens/auth/LoginScreen';
import SignUpScreen from './src/screens/auth/SignUpScreen';
import ChangePasswordScreen from './src/screens/auth/ChangePasswordScreen';
import SettingsSheet from './src/screens/SettingsSheet';
import OverviewScreen from './src/screens/admin/OverviewScreen';
import TeamScreen from './src/screens/admin/TeamScreen';
import LevelsScreen from './src/screens/staff/LevelsScreen';
import FleetScreen from './src/screens/staff/FleetScreen';
import StoreScreen from './src/screens/staff/StoreScreen';
import MpesaScreen from './src/screens/staff/MpesaScreen';
import FeedbackScreen from './src/screens/staff/FeedbackScreen';
import ReconcileScreen from './src/screens/staff/ReconcileScreen';
import ShopScreen from './src/screens/customer/ShopScreen';
import BulkScreen from './src/screens/customer/BulkScreen';
import MyOrdersScreen from './src/screens/customer/MyOrdersScreen';
import CustomerFeedbackScreen from './src/screens/customer/CustomerFeedbackScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Root />
      </AppProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const { booting, session } = useApp();
  if (booting) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#012A4A' }}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }
  if (!session) return (<><StatusBar style="light" /><AuthFlow /></>);
  if (session.mustChangePassword) return (<><StatusBar style="light" /><ChangePasswordScreen /></>);
  if (session.role === 'admin') return <AdminApp />;
  if (session.role === 'staff') return <StaffApp />;
  return <CustomerApp />;
}

/** Sign up first, then log in. */
function AuthFlow() {
  const [page, setPage] = useState({ name: 'login' });
  if (page.name === 'signup') {
    return <SignUpScreen onLogin={() => setPage({ name: 'login' })}
      onDone={(email) => setPage({ name: 'login', email, notice: 'Account created. Log in with your email and password.' })} />;
  }
  return <LoginScreen key={page.email ?? 'login'} initialEmail={page.email} notice={page.notice} onSignUp={() => setPage({ name: 'signup' })} />;
}

function Shell({ tabs, alerts, render, top }) {
  const [tab, setTab] = useState(tabs[0].key);
  const [settings, setSettings] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <StatusBar style="dark" />
      <AppHeader alerts={alerts} onAvatarPress={() => setSettings(true)} />
      {top}
      <View style={{ flex: 1 }}>{render(tab, setTab)}</View>
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
      <SettingsSheet visible={settings} onClose={() => setSettings(false)} />
    </View>
  );
}

function opsBadges(data) {
  const low = data?.settings?.lowLevelPercent ?? 20;
  return {
    lowTanks: (data?.tanks ?? []).filter((t) => pct(t.levelL, t.capacityL) < low).length,
    newOrders: (data?.orders ?? []).filter((o) => o.status === 'new').length,
    requests: (data?.deliveries ?? []).filter((d) => d.status === 'requested').length,
    openFeedback: (data?.feedback ?? []).filter((f) => f.status === 'open').length,
    unreviewed: (data?.reconciliations ?? []).filter((r) => r.flagged && !r.reviewedBy).length,
  };
}

const OPS_SCREENS = { levels: LevelsScreen, fleet: FleetScreen, store: StoreScreen, mpesa: MpesaScreen, recon: ReconcileScreen, feedback: FeedbackScreen };
const opsTabs = (b) => [
  { key: 'levels', label: 'Levels', icon: 'water', badge: b.lowTanks },
  { key: 'fleet', label: 'Fleet', icon: 'bus', badge: b.requests },
  { key: 'store', label: 'Store', icon: 'storefront', badge: b.newOrders },
  { key: 'mpesa', label: 'M-Pesa', icon: 'wallet' },
  { key: 'recon', label: 'Reconcile', icon: 'clipboard', badge: b.unreviewed },
  { key: 'feedback', label: 'Feedback', icon: 'chatbubbles', badge: b.openFeedback },
];

/** Staff: their own branch only (the server enforces this). */
function StaffApp() {
  const { data } = useApp();
  const b = opsBadges(data);
  return <Shell tabs={opsTabs(b)} alerts={b.lowTanks} render={(tab) => { const S = OPS_SCREENS[tab]; return <S />; }} />;
}

/** Admin: dashboard, team, and every operations screen across all branches (or one, via the picker). */
function AdminApp() {
  const { data, viewBranchId, setViewBranchId } = useApp();
  const b = opsBadges(data);
  const tabs = [
    { key: 'overview', label: 'Overview', icon: 'stats-chart' },
    { key: 'team', label: 'Team', icon: 'people' },
    ...opsTabs(b),
  ];
  const branches = data?.branches ?? [];
  const picker = branches.length ? (
    <View style={{ backgroundColor: colors.surface, paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Segmented value={viewBranchId ?? 'all'} onChange={(v) => setViewBranchId(v === 'all' ? null : v)}
        options={[{ value: 'all', label: 'All branches' }, ...branches.map((x) => ({ value: x.id, label: x.code }))]} />
    </View>
  ) : null;
  return (
    <Shell tabs={tabs} alerts={b.lowTanks} top={picker} render={(tab) => {
      if (tab === 'overview') return <OverviewScreen />;
      if (tab === 'team') return <TeamScreen />;
      const S = OPS_SCREENS[tab];
      return <S />;
    }} />
  );
}

function CustomerApp() {
  const { data } = useApp();
  const unpaid = (data?.orders ?? []).filter((o) => o.paymentStatus !== 'paid' && o.status !== 'cancelled').length;
  const tabs = [
    { key: 'shop', label: 'Shop', icon: 'water' },
    { key: 'bulk', label: 'Tanker', icon: 'bus' },
    { key: 'orders', label: 'My Orders', icon: 'receipt', badge: unpaid },
    { key: 'feedback', label: 'Feedback', icon: 'chatbubbles' },
  ];
  return (
    <Shell tabs={tabs} alerts={0} render={(tab, setTab) => {
      if (tab === 'shop') return <ShopScreen goToOrders={() => setTab('orders')} />;
      if (tab === 'bulk') return <BulkScreen />;
      if (tab === 'orders') return <MyOrdersScreen />;
      return <CustomerFeedbackScreen />;
    }} />
  );
}
