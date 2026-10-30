import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../AppContext';
import { colors, radius, type } from '../../theme';
import { isToday, kes, prettyPhone, timeAgo } from '../../format';
import { Badge, Button, Card, ChoiceGrid, Empty, Field, Hero, Screen, SectionHeader, Segmented, Sheet, ui } from '../../components/ui';
import PaymentSheet from '../../components/PaymentSheet';

const QUICK = [
  { value: 450, label: 'KES 450', sub: '20L refill' },
  { value: 2250, label: 'KES 2,250', sub: '5kL tanker' },
  { value: 4500, label: 'KES 4,500', sub: '10kL tanker' },
];
const SOURCE_ICON = { stk: 'phone-portrait', till: 'storefront', cash: 'cash' };

export default function MpesaScreen() {
  const { data } = useApp();
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [push, setPush] = useState(null);
  const [manual, setManual] = useState(false);
  const [filter, setFilter] = useState('all');

  const settings = data?.settings ?? {};
  const payments = data?.payments ?? [];
  const todayOk = payments.filter((p) => p.status === 'success' && isToday(p.createdAt));
  const collected = todayOk.reduce((s, p) => s + p.amount, 0);
  const shown = filter === 'all' ? payments : payments.filter((p) => p.status === filter);

  return (
    <Screen>
      <Hero>
        <View style={ui.between}>
          <View style={[ui.row, { gap: 8 }]}>
            <View style={styles.walletIcon}><Ionicons name="wallet" size={18} color={colors.onPrimary} /></View>
            <Text style={styles.caption}>SAFARICOM M-PESA TILL</Text>
          </View>
          <Badge label={settings.mpesaMode === 'live' ? 'Live · Direct settle' : 'Test mode'} color={colors.mintDeep} bg={settings.mpesaMode === 'live' ? '#7BF5BC' : '#FFE7A8'} />
        </View>
        <View style={ui.between}>
          <View>
            <Text style={styles.small}>Till number</Text>
            <Text style={styles.till}>{settings.tillNumber}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', flex: 1 }}>
            <Text style={styles.small}>Account name</Text>
            <Text style={[styles.till, { fontSize: 16 }]} numberOfLines={1}>{settings.companyName}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={ui.between}>
          <View>
            <Text style={styles.small}>Today’s collections</Text>
            <Text style={styles.till}>{kes(collected)}</Text>
          </View>
          <Text style={styles.small}>{todayOk.length} transactions</Text>
        </View>
      </Hero>

      <Card>
        <View style={ui.between}>
          <View style={[ui.row, { gap: 10, flex: 1 }]}>
            <View style={styles.stkIcon}><Ionicons name="phone-portrait" size={20} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={type.title}>Instant STK Push</Text>
              <Text style={type.bodySm}>Trigger a PIN prompt on the customer’s phone</Text>
            </View>
          </View>
        </View>
        <Field label="Customer mobile number" keyboardType="phone-pad" placeholder="0712 849 203" value={phone} onChangeText={setPhone} />
        <Field label="Amount (KES)" prefix="KES" keyboardType="numeric" value={amount} onChangeText={setAmount} placeholder="2200" />
        <ChoiceGrid value={Number(amount)} onChange={(v) => setAmount(String(v))} options={QUICK} />
        <Field label="Reason" placeholder="e.g. 4× 20L refill" value={description} onChangeText={setDescription} />
        <Button title="Send M-Pesa STK prompt" icon="flash" variant="mpesa" disabled={!phone || !Number(amount)}
          onPress={() => setPush({ amount: Number(amount), description: description || 'Water payment', payerName: '' })} />
        <Button title="Record till / cash payment" icon="create-outline" variant="ghost" onPress={() => setManual(true)} />
      </Card>

      <SectionHeader title="Till transactions" subtitle="Updates live" icon="pulse" />
      <Segmented value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'All', count: payments.length },
        { value: 'success', label: 'Paid', count: payments.filter((p) => p.status === 'success').length },
        { value: 'pending', label: 'Pending', count: payments.filter((p) => p.status === 'pending').length },
        { value: 'failed', label: 'Failed', count: payments.filter((p) => p.status === 'failed').length },
      ]} />
      {shown.length === 0 ? <Empty icon="wallet-outline" title="No transactions" /> : null}
      {shown.map((p) => (
        <Card key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={styles.txIcon}><Ionicons name={SOURCE_ICON[p.source] ?? 'water'} size={20} color={colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <View style={[ui.row, { gap: 6 }]}>
              <Text style={type.label} numberOfLines={1}>{p.payerName || prettyPhone(p.phone) || 'Customer'}</Text>
              {p.status === 'success' ? <Ionicons name="checkmark-circle" size={16} color={colors.mint} /> : null}
            </View>
            <Text style={type.bodySm} numberOfLines={1}>
              {p.mpesaReceipt ? <Text style={{ fontWeight: '700' }}>{p.mpesaReceipt} · </Text> : null}{p.description}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text style={[type.label, type.num, { color: p.status === 'success' ? colors.mintDeep : p.status === 'failed' ? colors.danger : colors.amber }]}>
              {p.status === 'success' ? '+' : ''}{kes(p.amount)}
            </Text>
            {p.status !== 'success' ? <Badge status={p.status} /> : <Text style={type.bodySm}>{timeAgo(p.createdAt)}</Text>}
          </View>
        </Card>
      ))}

      <PaymentSheet visible={Boolean(push)} onClose={() => { setPush(null); setPhone(''); setAmount(''); setDescription(''); }} target={push} defaultPhone={phone} title="STK push" />
      <ManualSheet visible={manual} onClose={() => setManual(false)} />
    </Screen>
  );
}

function ManualSheet({ visible, onClose }) {
  const { data, act } = useApp();
  const [form, setForm] = useState({ method: 'till', mpesaReceipt: '', amount: '', phone: '', payerName: '', link: null });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const unpaid = [
    ...(data?.orders ?? []).filter((o) => o.paymentStatus !== 'paid' && o.status !== 'cancelled').map((o) => ({ value: `o:${o.id}`, label: o.id, sub: `${o.customerName} · ${kes(o.total)}`, amount: o.total })),
    ...(data?.deliveries ?? []).filter((d) => d.paymentStatus !== 'paid' && d.status !== 'cancelled').map((d) => ({ value: `d:${d.id}`, label: d.id, sub: `${d.customerName} · ${kes(d.amount)}`, amount: d.amount })),
  ];
  const save = async () => {
    const [kind, id] = (form.link || '').split(':');
    const ok = await act((api) => api.post('/api/payments/manual', {
      ...form, orderId: kind === 'o' ? id : null, deliveryId: kind === 'd' ? id : null,
      description: id ? `${kind === 'o' ? 'Order' : 'Bulk'} ${id}` : 'Till payment',
    }), 'Payment recorded');
    if (ok) { setForm({ method: 'till', mpesaReceipt: '', amount: '', phone: '', payerName: '', link: null }); onClose(); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Record payment" subtitle="Customer paid to the till directly, or in cash"
      footer={<Button title="Save payment" icon="checkmark" variant="mpesa" onPress={save} />}>
      <ChoiceGrid columns={2} value={form.method} onChange={set('method')} options={[{ value: 'till', label: 'M-Pesa till' }, { value: 'cash', label: 'Cash' }]} />
      {form.method === 'till' ? <Field label="M-Pesa code" autoCapitalize="characters" placeholder="QKH4891MN" value={form.mpesaReceipt} onChangeText={set('mpesaReceipt')} /> : null}
      <Field label="Amount (KES)" keyboardType="numeric" value={String(form.amount)} onChangeText={set('amount')} />
      <Field label="Payer name" value={form.payerName} onChangeText={set('payerName')} />
      <Field label="Phone" keyboardType="phone-pad" value={form.phone} onChangeText={set('phone')} />
      {unpaid.length ? (
        <>
          <Text style={type.caption}>Settles (optional)</Text>
          <ChoiceGrid columns={2} value={form.link} onChange={(v) => {
            const match = unpaid.find((u) => u.value === v);
            setForm((f) => ({ ...f, link: f.link === v ? null : v, amount: match ? String(match.amount) : f.amount }));
          }} options={unpaid} />
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  caption: { color: colors.cyanSoft, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  walletIcon: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  small: { color: colors.cyanSoft, fontSize: 13 },
  till: { color: colors.onPrimary, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.18)' },
  stkIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surfaceLow, alignItems: 'center', justifyContent: 'center' },
  txIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surfaceLow, alignItems: 'center', justifyContent: 'center' },
});
