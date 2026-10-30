import { useState } from 'react';
import { Text, View } from 'react-native';
import { confirm, useApp } from '../../AppContext';
import { colors, type } from '../../theme';
import { kes, timeAgo } from '../../format';
import { Badge, Button, Card, Empty, InfoRow, Screen, SectionHeader, ui } from '../../components/ui';
import PaymentSheet from '../../components/PaymentSheet';

const STEPS = ['new', 'confirmed', 'dispatched', 'delivered'];
const LABELS = { new: 'Received', confirmed: 'Preparing', dispatched: 'On the way', delivered: 'Delivered' };

export default function MyOrdersScreen() {
  const { data, session, act } = useApp();
  const [paying, setPaying] = useState(null);
  const orders = data?.orders ?? [];

  const cancel = async (o) => {
    if (await confirm('Cancel this order?', `${o.id} · ${kes(o.total)}`, 'Cancel order')) act((api) => api.patch(`/api/orders/${o.id}`, { status: 'cancelled' }));
  };

  return (
    <Screen>
      <SectionHeader title="My orders" subtitle="Live status from the hub" icon="receipt" />
      {orders.length === 0 ? <Empty icon="receipt-outline" title="No orders yet" text="Orders you place in the shop show up here with live delivery status." /> : null}
      {orders.map((o) => {
        const idx = STEPS.indexOf(o.status);
        return (
          <Card key={o.id} accent={o.status === 'cancelled' ? colors.danger : o.status === 'delivered' ? colors.mint : colors.primary}>
            <View style={ui.between}>
              <View>
                <Text style={type.title}>#{o.id}</Text>
                <Text style={type.bodySm}>{timeAgo(o.createdAt)}</Text>
              </View>
              <Badge status={o.status} />
            </View>
            <View style={ui.inset}>
              {o.items.map((i) => (
                <View key={i.productId + i.refill} style={ui.between}>
                  <Text style={[type.body, { flex: 1 }]}>{i.qty}× {i.name}</Text>
                  <Text style={[type.bodySm, type.num]}>{kes(i.qty * i.unitPrice)}</Text>
                </View>
              ))}
            </View>
            {idx >= 0 ? (
              <View>
                <View style={[ui.row, { gap: 4 }]}>
                  {STEPS.map((s, i) => <View key={s} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= idx ? colors.mint : colors.surfaceHigh }} />)}
                </View>
                <View style={[ui.between, { marginTop: 4 }]}>
                  {STEPS.map((s, i) => <Text key={s} style={[type.bodySm, { fontSize: 11 }, i === idx && { color: colors.mintDeep, fontWeight: '700' }]}>{LABELS[s]}</Text>)}
                </View>
              </View>
            ) : null}
            <InfoRow icon="location">{o.address}</InfoRow>
            {o.rider ? <InfoRow icon="bicycle">Rider: {o.rider}</InfoRow> : null}
            <View style={ui.between}>
              <Text style={[type.headline, type.num, { color: colors.primaryDeep }]}>{kes(o.total)}</Text>
              {o.paymentStatus === 'paid'
                ? <Badge status="paid" icon="checkmark-circle" label={o.mpesaRef ? `M-Pesa ${o.mpesaRef}` : 'Paid'} />
                : o.status !== 'cancelled' ? <Button small title="Pay with M-Pesa" icon="phone-portrait" variant="mpesa" onPress={() => setPaying(o)} /> : null}
            </View>
            {['new', 'confirmed'].includes(o.status) && o.paymentStatus !== 'paid' ? (
              <Button small title="Cancel order" variant="danger" icon="close" onPress={() => cancel(o)} />
            ) : null}
          </Card>
        );
      })}
      <PaymentSheet visible={Boolean(paying)} onClose={() => setPaying(null)}
        target={paying ? { orderId: paying.id, amount: paying.total, description: `Order ${paying.id}` } : null}
        defaultPhone={session?.phone} />
    </Screen>
  );
}
