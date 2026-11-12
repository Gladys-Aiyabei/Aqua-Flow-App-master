import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../AppContext';
import { colors, radius, type } from '../../theme';
import { formatNumber, kes, pct, timeAgo } from '../../format';
import { Badge, Button, Card, Empty, Hero, HeroStat, ProgressBar, Screen, SectionHeader, Segmented, ui } from '../../components/ui';

const SOURCE_LABEL = { stk: 'M-Pesa prompts', till: 'Till payments', cash: 'Cash' };
const SOURCE_ICON = { stk: 'phone-portrait', till: 'storefront', cash: 'cash' };
const FILTERS = {
  all: () => true,
  money: (a) => a.action.startsWith('payment.'),
  orders: (a) => /^(order|delivery)\./.test(a.action),
  team: (a) => /^(staff|admin|user|branch|settings|product)\./.test(a.action),
  signins: (a) => a.action.startsWith('auth.'),
};
function iconFor(action) {
  if (action.startsWith('payment.received')) return ['cash', colors.mintDeep];
  if (action.startsWith('payment.failed') || action === 'auth.login_failed') return ['alert-circle', colors.danger];
  if (action.startsWith('payment.')) return ['phone-portrait', colors.primary];
  if (action.startsWith('order.')) return ['receipt', colors.primary];
  if (action.startsWith('delivery.')) return ['bus', colors.cyan];
  if (action.startsWith('auth.')) return ['log-in', colors.textMuted];
  if (/^(staff|admin|user)\./.test(action)) return ['people', colors.primaryDeep];
  if (action.startsWith('tank.') || action.startsWith('reconciliation.')) return ['water', colors.cyan];
  return ['ellipse', colors.textFaint];
}

/** Admin dashboard: money in, what's open right now, and everything that happened. */
export default function OverviewScreen() {
  const { data, viewBranchId } = useApp();
  const [filter, setFilter] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const e = data?.earnings;
  if (!e) return <Screen><Empty title="Loading dashboard" text="Fetching the latest numbers…" /></Screen>;

  const low = data.settings?.lowLevelPercent ?? 20;
  const counts = [
    { label: 'Open orders', value: (data.orders ?? []).filter((o) => ['new', 'confirmed', 'dispatched'].includes(o.status)).length, icon: 'receipt' },
    { label: 'Tanker missions', value: (data.deliveries ?? []).filter((d) => !['delivered', 'cancelled'].includes(d.status)).length, icon: 'bus' },
    { label: 'Low tanks', value: (data.tanks ?? []).filter((t) => pct(t.levelL, t.capacityL) < low).length, icon: 'water' },
    { label: 'Needs reply', value: (data.feedback ?? []).filter((f) => f.status === 'open').length, icon: 'chatbubbles' },
    { label: 'Customers', value: data.counts?.customers ?? 0, icon: 'people' },
    { label: 'Active staff', value: data.counts?.staff ?? 0, icon: 'id-card' },
  ];
  const maxDay = Math.max(1, ...e.daily.map((d) => d.total));
  const maxBranch = Math.max(1, ...e.byBranch.map((b) => b.allTime));
  const activity = (data.activity ?? []).filter(FILTERS[filter]);
  const branchName = viewBranchId ? data.branches?.find((b) => b.id === viewBranchId)?.code : null;

  return (
    <Screen>
      <Hero>
        <Text style={styles.caption}>EARNINGS {branchName ? `· ${branchName}` : '· ALL BRANCHES'}</Text>
        <Text style={styles.value}>{kes(e.month)}</Text>
        <Text style={{ color: colors.cyanSoft }}>received this month · {formatNumber(e.payments)} payments in total</Text>
        <View style={[ui.row, { gap: 8 }]}>
          <HeroStat label="Today" value={kes(e.today)} />
          <HeroStat label="7 days" value={kes(e.week)} />
          <HeroStat label="All time" value={kes(e.allTime)} />
        </View>
      </Hero>

      {e.unpaid > 0 ? (
        <Card accent={colors.amber}>
          <View style={ui.between}>
            <Text style={type.title}>Waiting for payment</Text>
            <Text style={[type.headline, type.num, { color: colors.amber }]}>{kes(e.unpaid)}</Text>
          </View>
          <Text style={type.bodySm}>Open orders and tanker deliveries that are not paid yet.</Text>
        </Card>
      ) : null}

      <View style={styles.grid}>
        {counts.map((c) => (
          <View key={c.label} style={styles.tile}>
            <Ionicons name={c.icon} size={18} color={colors.primary} />
            <Text style={[type.metric, { fontSize: 24 }]}>{formatNumber(c.value)}</Text>
            <Text style={type.bodySm} numberOfLines={1}>{c.label}</Text>
          </View>
        ))}
      </View>

      <Card>
        <Text style={type.title}>Last 14 days</Text>
        {e.daily.length ? (
          <View style={styles.chart} accessibilityLabel={`Daily earnings: ${e.daily.map((d) => `${d.day} ${kes(d.total)}`).join(', ')}`}>
            {e.daily.map((d) => (
              <View key={d.day} style={styles.barCol}>
                <View style={[styles.bar, { height: `${Math.max(4, (d.total / maxDay) * 100)}%` }]} />
                <Text style={styles.barLabel}>{d.day.slice(8)}</Text>
              </View>
            ))}
          </View>
        ) : <Text style={type.bodySm}>No payments in the last 14 days.</Text>}
      </Card>

      <Card>
        <Text style={type.title}>By branch</Text>
        {e.byBranch.length === 0 ? <Text style={type.bodySm}>No payments yet.</Text> : null}
        {e.byBranch.map((b) => (
          <View key={b.branchId ?? 'none'} style={{ gap: 4 }}>
            <View style={ui.between}>
              <Text style={type.label}>{b.code} · {b.name}</Text>
              <Text style={[type.label, type.num]}>{kes(b.allTime)}</Text>
            </View>
            <ProgressBar value={(b.allTime / maxBranch) * 100} color={colors.primary} height={6} />
            <Text style={type.bodySm}>{kes(b.month)} this month · {formatNumber(b.payments)} payments</Text>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={type.title}>By payment type</Text>
        {e.bySource.length === 0 ? <Text style={type.bodySm}>No payments yet.</Text> : null}
        {e.bySource.map((s) => (
          <View key={s.source} style={[ui.between, { gap: 10 }]}>
            <View style={[ui.row, { gap: 8, flex: 1 }]}>
              <Ionicons name={SOURCE_ICON[s.source] ?? 'wallet'} size={18} color={colors.primary} />
              <Text style={type.body}>{SOURCE_LABEL[s.source] ?? s.source}</Text>
            </View>
            <Text style={[type.label, type.num]}>{kes(s.total)}</Text>
          </View>
        ))}
      </Card>

      <SectionHeader title="Activity" subtitle="Everything that happens, newest first" icon="pulse" />
      <Segmented value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'All' }, { value: 'money', label: 'Money' }, { value: 'orders', label: 'Orders' },
        { value: 'team', label: 'Team' }, { value: 'signins', label: 'Sign-ins' },
      ]} />
      {activity.length === 0 ? <Empty icon="pulse-outline" title="Nothing yet" /> : null}
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {activity.slice(0, showAll ? 150 : 25).map((a, i) => {
          const [icon, tint] = iconFor(a.action);
          return (
            <View key={a.id} style={[styles.event, i > 0 && styles.eventBorder]}>
              <View style={styles.eventIcon}><Ionicons name={icon} size={16} color={tint} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.body}>{a.summary}</Text>
                <Text style={type.bodySm} numberOfLines={1}>
                  {timeAgo(a.createdAt)}{a.userEmail ? ` · ${a.userEmail}` : a.userRole === 'system' ? ' · automatic' : ''}{a.branchCode ? ` · ${a.branchCode}` : ''}
                </Text>
              </View>
              {a.amount ? <Badge label={kes(a.amount)} color={a.action === 'payment.received' ? colors.mintDeep : colors.primaryDeep}
                bg={a.action === 'payment.received' ? colors.mintSoft : colors.surfaceLow} /> : null}
            </View>
          );
        })}
      </Card>
      {activity.length > 25 ? <Button small variant="ghost" title={showAll ? 'Show less' : `Show all ${Math.min(activity.length, 150)}`} onPress={() => setShowAll((s) => !s)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  caption: { color: colors.cyanSoft, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  value: { color: colors.onPrimary, fontSize: 34, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '31%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 12, gap: 2, borderWidth: 1, borderColor: colors.border },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 4 },
  barCol: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
  bar: { width: '100%', backgroundColor: colors.cyan, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barLabel: { fontSize: 10, color: colors.textFaint },
  event: { flexDirection: 'row', gap: 10, paddingVertical: 10, alignItems: 'flex-start' },
  eventBorder: { borderTopWidth: 1, borderTopColor: colors.divider },
  eventIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceLow },
});
