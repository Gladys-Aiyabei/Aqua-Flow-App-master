import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { confirm, useApp } from '../../AppContext';
import { colors, radius, type } from '../../theme';
import { kes, litres, prettyPhone, timeAgo } from '../../format';
import { Badge, Button, Card, Empty, Hero, InfoRow, Screen, Segmented, ui } from '../../components/ui';
import PaymentSheet from '../../components/PaymentSheet';
import MapEmbed from '../../components/MapEmbed';

const STEPS = ['new', 'confirmed', 'dispatched', 'delivered'];
const LABELS = { new: 'Received', confirmed: 'Preparing', dispatched: 'On the way', delivered: 'Delivered' };
const PAY_STATUS = {
  success: { label: 'Paid', icon: 'checkmark-circle', color: colors.mintDeep, bg: colors.mintSoft },
  pending: { label: 'Waiting for PIN', icon: 'time', color: colors.amber, bg: colors.amberSoft },
  failed: { label: 'Not completed', icon: 'close-circle', color: colors.danger, bg: colors.dangerSoft },
};
const SOURCE = { stk: 'M-Pesa prompt', till: 'M-Pesa till', cash: 'Cash' };

const fullDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/** The customer's orders, what they still owe, and every payment they have made. */
export default function MyOrdersScreen() {
  const { data, session, act } = useApp();
  const [view, setView] = useState('orders');
  const [paying, setPaying] = useState(null); // { kind: 'order' | 'delivery', item }
  const [mapFor, setMapFor] = useState(null);
  const orders = data?.orders ?? [];
  const deliveries = data?.deliveries ?? [];
  const payments = data?.payments ?? [];

  const due = [
    ...orders.filter((o) => o.paymentStatus !== 'paid' && o.status !== 'cancelled')
      .map((o) => ({ kind: 'order', id: o.id, amount: o.total, label: `Order ${o.id}`, sub: o.items.map((i) => `${i.qty}× ${i.name}`).join(', '), cash: o.paymentMethod === 'cash', item: o })),
    ...deliveries.filter((d) => d.paymentStatus !== 'paid' && d.status !== 'cancelled')
      .map((d) => ({ kind: 'delivery', id: d.id, amount: d.amount, label: `Tanker ${d.id}`, sub: `${litres(d.volumeL)} to ${d.destination}`, item: d })),
  ];
  const owed = due.reduce((s, x) => s + Number(x.amount || 0), 0);
  const paid = payments.filter((p) => p.status === 'success').reduce((s, p) => s + Number(p.amount || 0), 0);

  const cancel = async (o) => {
    if (await confirm('Cancel this order?', `${o.id} · ${kes(o.total)}`, 'Cancel order')) act((api) => api.patch(`/api/orders/${o.id}`, { status: 'cancelled' }));
  };
  const pay = (x) => setPaying({ kind: x.kind, item: x.item });

  return (
    <Screen>
      <Hero>
        <Text style={styles.caption}>MY ACCOUNT</Text>
        <View style={[ui.row, { gap: 10 }]}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Paid so far</Text>
            <Text style={styles.statValue}>{kes(paid)}</Text>
          </View>
          <View style={[styles.stat, owed > 0 && { backgroundColor: 'rgba(232,155,12,0.28)' }]}>
            <Text style={styles.statLabel}>To pay</Text>
            <Text style={styles.statValue}>{kes(owed)}</Text>
          </View>
        </View>
        <Text style={{ color: colors.cyanSoft, fontSize: 13 }}>Pay by M-Pesa: tap Pay now and enter your PIN on the prompt, or use Till {data?.settings?.tillNumber}.</Text>
      </Hero>

      {due.length ? (
        <Card accent={colors.amber}>
          <View style={[ui.row, { gap: 8 }]}>
            <Ionicons name="wallet" size={20} color={colors.amber} />
            <Text style={type.title}>Needs payment</Text>
          </View>
          {due.map((x, i) => (
            <View key={x.kind + x.id} style={[styles.dueRow, i > 0 && styles.divider]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.label}>{x.label}</Text>
                <Text style={type.bodySm} numberOfLines={1}>{x.sub}</Text>
                {x.cash ? <Text style={[type.bodySm, { color: colors.amber }]}>You chose cash on delivery</Text> : null}
              </View>
              <Button small variant="mpesa" icon="phone-portrait" title={`Pay ${kes(x.amount)}`} onPress={() => pay(x)} />
            </View>
          ))}
        </Card>
      ) : null}

      <Segmented value={view} onChange={setView} options={[
        { value: 'orders', label: 'Orders', count: orders.length },
        { value: 'payments', label: 'Payments', count: payments.length },
      ]} />

      {view === 'orders' ? (
        <>
          {orders.length === 0 ? <Empty icon="receipt-outline" title="No orders yet" text="Orders you place in the Shop show up here with live delivery status." /> : null}
          {orders.map((o) => {
            const idx = STEPS.indexOf(o.status);
            const showMap = mapFor === o.id;
            return (
              <Card key={o.id} accent={o.status === 'cancelled' ? colors.danger : o.status === 'delivered' ? colors.mint : colors.primary}>
                <View style={ui.between}>
                  <View>
                    <Text style={type.title}>Order {o.id}</Text>
                    <Text style={type.bodySm}>{fullDate(o.createdAt)}</Text>
                  </View>
                  <Badge status={o.status} />
                </View>

                <View style={ui.inset}>
                  {o.items.map((i) => (
                    <View key={i.productId + i.refill} style={ui.between}>
                      <Text style={[type.body, { flex: 1 }]}>{i.qty}× {i.name}{i.refill ? ' (refill)' : ''}</Text>
                      <Text style={[type.bodySm, type.num]}>{kes(i.qty * i.unitPrice)}</Text>
                    </View>
                  ))}
                  <View style={[ui.between, styles.totalRow]}>
                    <Text style={type.label}>Total</Text>
                    <Text style={[type.label, type.num]}>{kes(o.total)}</Text>
                  </View>
                </View>

                {idx >= 0 ? (
                  <View>
                    <View style={[ui.row, { gap: 4 }]}>
                      {STEPS.map((s, i) => <View key={s} style={[styles.step, i <= idx && { backgroundColor: colors.mint }]} />)}
                    </View>
                    <View style={[ui.between, { marginTop: 4 }]}>
                      {STEPS.map((s, i) => <Text key={s} style={[styles.stepLabel, i === idx && { color: colors.mintDeep, fontWeight: '700' }]}>{LABELS[s]}</Text>)}
                    </View>
                  </View>
                ) : null}

                <Pressable onPress={() => setMapFor(showMap ? null : o.id)} style={styles.mapToggle} accessibilityRole="button">
                  <Ionicons name={o.latitude ? 'location' : 'location-outline'} size={18} color={colors.primary} />
                  <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>{o.address}{o.latitude ? ' · pinned' : ''}</Text>
                  <Text style={styles.link}>{showMap ? 'Hide map' : 'Show map'}</Text>
                </Pressable>
                {showMap ? <MapEmbed latitude={o.latitude} longitude={o.longitude} address={o.address} /> : null}
                {o.rider ? <InfoRow icon="bicycle">Rider: {o.rider}</InfoRow> : null}

                {o.paymentStatus === 'paid' ? (
                  <View style={styles.paidRow}>
                    <Ionicons name="checkmark-circle" size={20} color={colors.mintDeep} />
                    <Text style={[type.label, { color: colors.mintDeep, flex: 1 }]}>
                      Paid {o.paymentMethod === 'cash' ? 'in cash' : 'by M-Pesa'}{o.mpesaRef ? ` · ${o.mpesaRef}` : ''}
                    </Text>
                  </View>
                ) : o.status !== 'cancelled' ? (
                  <Button title={`Pay ${kes(o.total)} now with M-Pesa`} icon="phone-portrait" variant="mpesa" onPress={() => setPaying({ kind: 'order', item: o })} />
                ) : null}
                {['new', 'confirmed'].includes(o.status) && o.paymentStatus !== 'paid' ? (
                  <Button small title="Cancel order" variant="ghost" icon="close" onPress={() => cancel(o)} />
                ) : null}
              </Card>
            );
          })}
        </>
      ) : (
        <>
          {payments.length === 0 ? <Empty icon="wallet-outline" title="No payments yet" text="When you pay for an order or a tanker, the M-Pesa receipt shows up here." /> : null}
          {payments.map((p) => {
            const st = PAY_STATUS[p.status] ?? PAY_STATUS.pending;
            return (
              <Card key={p.id} style={{ gap: 6 }}>
                <View style={ui.between}>
                  <View style={[ui.row, { gap: 10, flex: 1 }]}>
                    <View style={[styles.payIcon, { backgroundColor: st.bg }]}><Ionicons name={st.icon} size={20} color={st.color} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={type.label}>{p.description}</Text>
                      <Text style={type.bodySm}>{fullDate(p.settledAt || p.createdAt)}</Text>
                    </View>
                  </View>
                  <Text style={[type.title, type.num, { color: p.status === 'success' ? colors.mintDeep : colors.text }]}>{kes(p.amount)}</Text>
                </View>
                <View style={[ui.row, { gap: 8, flexWrap: 'wrap' }]}>
                  <Badge label={st.label} icon={st.icon} color={st.color} bg={st.bg} />
                  <Badge label={SOURCE[p.source] ?? p.source} color={colors.primaryDeep} bg={colors.surfaceLow} />
                  {p.mpesaReceipt ? <Badge label={`Code ${p.mpesaReceipt}`} color={colors.text} bg={colors.surfaceMid} /> : null}
                </View>
                {p.phone ? <Text style={type.bodySm}>From {prettyPhone(p.phone)}{p.status === 'failed' && p.resultDesc ? ` · ${p.resultDesc}` : ''}</Text> : null}
              </Card>
            );
          })}
          {payments.length ? <Text style={[type.bodySm, { textAlign: 'center' }]}>Showing {payments.length} payment{payments.length > 1 ? 's' : ''} · {timeAgo(payments[payments.length - 1].createdAt)} to now</Text> : null}
        </>
      )}

      <PaymentSheet visible={Boolean(paying)} onClose={() => setPaying(null)}
        target={paying ? (paying.kind === 'order'
          ? { orderId: paying.item.id, amount: paying.item.total, description: `Order ${paying.item.id}` }
          : { deliveryId: paying.item.id, amount: paying.item.amount, description: `Tanker ${paying.item.id}` }) : null}
        defaultPhone={session?.phone} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  caption: { color: colors.cyanSoft, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  stat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: radius.md, padding: 12, gap: 2 },
  statLabel: { color: colors.cyanSoft, fontSize: 13 },
  statValue: { color: colors.onPrimary, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10 },
  divider: { borderTopWidth: 1, borderTopColor: colors.divider },
  totalRow: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 6 },
  step: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceHigh },
  stepLabel: { fontSize: 11, color: colors.textMuted },
  mapToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  link: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  paidRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.mintSoft },
  payIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
