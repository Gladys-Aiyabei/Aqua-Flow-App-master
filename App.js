import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/AppContext';
import { colors } from './src/theme';
import { pct } from './src/format';
import { AppHeader } from './src/components/ui';
import TabBar from './src/components/TabBar';
import LoginScreen from './src/screens/LoginScreen';
import SettingsSheet from './src/screens/SettingsSheet';
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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryDeep }}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }
  if (!session) return (<><StatusBar style="light" /><LoginScreen /></>);
  return session.role === 'staff' ? <StaffApp /> : <CustomerApp />;
}

function Shell({ tabs, alerts, render }) {
  const [tab, setTab] = useState(tabs[0].key);
  const [settings, setSettings] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <StatusBar style="dark" />
      <AppHeader alerts={alerts} onAvatarPress={() => setSettings(true)} />
      <View style={{ flex: 1 }}>{render(tab, setTab)}</View>
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
      <SettingsSheet visible={settings} onClose={() => setSettings(false)} />
    </View>
  );
}

function StaffApp() {
  const { data } = useApp();
  const low = data?.settings?.lowLevelPercent ?? 20;
  const lowTanks = (data?.tanks ?? []).filter((t) => pct(t.levelL, t.capacityL) < low).length;
  const newOrders = (data?.orders ?? []).filter((o) => o.status === 'new').length;
  const requests = (data?.deliveries ?? []).filter((d) => d.status === 'requested').length;
  const openFeedback = (data?.feedback ?? []).filter((f) => f.status === 'open').length;
  const unreviewed = (data?.reconciliations ?? []).filter((r) => r.flagged && !r.reviewedBy).length;

  const tabs = [
    { key: 'levels', label: 'Levels', icon: 'water', badge: lowTanks },
    { key: 'fleet', label: 'Fleet', icon: 'bus', badge: requests },
    { key: 'store', label: 'Store', icon: 'storefront', badge: newOrders },
    { key: 'mpesa', label: 'M-Pesa', icon: 'wallet' },
    { key: 'recon', label: 'Reconcile', icon: 'clipboard', badge: unreviewed },
    { key: 'feedback', label: 'Feedback', icon: 'chatbubbles', badge: openFeedback },
  ];
  const screens = { levels: LevelsScreen, fleet: FleetScreen, store: StoreScreen, mpesa: MpesaScreen, recon: ReconcileScreen, feedback: FeedbackScreen };
  return <Shell tabs={tabs} alerts={lowTanks} render={(tab) => { const S = screens[tab]; return <S />; }} />;
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
