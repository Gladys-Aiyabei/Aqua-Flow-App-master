import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { notify, useApp } from '../../AppContext';
import { colors, radius, shadowStrong, space, type } from '../../theme';
import { isValidKenyanPhone, kes, localPhone } from '../../format';
import { Badge, Button, Card, ChoiceGrid, Empty, Field, Hero, Screen, SectionHeader, Sheet, Stepper, ui } from '../../components/ui';
import PaymentSheet from '../../components/PaymentSheet';
import DeliveryAreaCard, { useDeliveryArea } from '../../components/DeliveryAreaCard';
import LocationPicker from '../../components/LocationPicker';

export default function ShopScreen({ goToOrders }) {
  const { data, session, act, api } = useApp();
  const [cart, setCart] = useState({}); // productId -> { qty, refill }
  const [checkout, setCheckout] = useState(false);
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [spot, setSpot] = useState(null); // { latitude, longitude } from "Use my location"
  const [payMethod, setPayMethod] = useState('mpesa');
  const [payPhone, setPayPhone] = useState('');
  const [placing, setPlacing] = useState(false);
  const [formError, setFormError] = useState('');
  const [paying, setPaying] = useState(null); // { order, payment, error }
  const [snap, setSnap] = useState({ lines: [], total: 0 }); // what the checkout shows, frozen while it's open
  const { hasArea } = useDeliveryArea();

  const products = data?.products ?? [];
  const priceOf = (p, refill) => (refill && p.refillPrice ? p.refillPrice : p.price);
  const lines = products.filter((p) => cart[p.id]?.qty > 0).map((p) => ({ p, ...cart[p.id] }));
  const total = lines.reduce((s, l) => s + l.qty * priceOf(l.p, l.refill), 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const update = (id, patch) => setCart((c) => ({ ...c, [id]: { qty: 0, refill: false, ...c[id], ...patch } }));

  const lastAddress = data?.orders?.[0]?.address;

  const openCheckout = () => {
    if (!hasArea) { notify('Choose your delivery area', 'Pick your area at the top of this screen, then check out.'); return; }
    setAddress((a) => a || lastAddress || '');
    setPayPhone((p) => p || localPhone(session?.phone));
    setFormError('');
    setSnap({ lines, total });
    setCheckout(true);
  };

  const placeOrder = async () => {
    if (placing) return;
    if (!address.trim() && !spot) { setFormError('Add your delivery address or use your location.'); return; }
    if (payMethod === 'mpesa' && !isValidKenyanPhone(payPhone)) { setFormError('Enter the M-Pesa number to charge, e.g. 0712 345 678.'); return; }
    setFormError(''); setPlacing(true);
    const order = await act((a) => a.post('/api/orders', {
      address: address.trim() || 'Pinned location', notes, paymentMethod: payMethod, ...(spot ?? {}),
      items: snap.lines.map((l) => ({ productId: l.p.id, qty: l.qty, refill: l.refill })),
    }));
    if (!order) { setPlacing(false); return; }
    setCart({}); setCheckout(false); setNotes(''); setSpot(null);
    if (payMethod === 'cash') {
      setPlacing(false);
      notify('Order placed', `Order ${order.id} is on its way to the team. Pay ${kes(order.total)} in cash when it arrives.`);
      goToOrders?.();
      return;
    }
    // M-Pesa: send the PIN prompt straight away, then show the waiting screen.
    try {
      const res = await api.post('/api/payments/stk', { orderId: order.id, phone: payPhone });
      setPaying({ order, payment: res.payment });
    } catch (e) {
      setPaying({ order, payment: null, error: e.message });
    }
    setPlacing(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen footerSpace={count ? 110 : 24}>
        <Hero>
          <Text style={styles.hello}>Jambo, {session?.name?.split(' ')[0]} 👋</Text>
          <Text style={styles.heroTitle}>Fresh water, delivered to your door</Text>
          <View style={[ui.row, { gap: 8, flexWrap: 'wrap' }]}>
            <Badge label="Purified & sealed" icon="shield-checkmark" color={colors.onPrimary} bg="rgba(255,255,255,0.18)" />
            <Badge label={`Lipa na M-Pesa · Till ${data?.settings?.tillNumber ?? ''}`} icon="phone-portrait" color={colors.onPrimary} bg="rgba(0,168,107,0.55)" />
          </View>
        </Hero>

        <DeliveryAreaCard />

        <SectionHeader title="Packaged water" subtitle="Choose new bottles or refills" icon="water" />
        {products.length === 0 ? <Empty title="Shop is restocking" text="Please check back shortly." /> : null}
        {products.map((p) => {
          const item = cart[p.id] ?? { qty: 0, refill: Boolean(p.refillPrice) };
          const out = p.stock === 0;
          return (
            <Card key={p.id} style={out && { opacity: 0.5 }}>
              <View style={[ui.row, { gap: 12 }]}>
                <View style={styles.bottle}>
                  <Ionicons name="water" size={34} color={colors.primary} />
                  <Text style={styles.size}>{p.size}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={type.title}>{p.name}</Text>
                  <Text style={type.bodySm}>{p.description}</Text>
                  <Text style={[type.headline, type.num, { color: colors.primaryDeep, marginTop: 4 }]}>{kes(priceOf(p, item.refill))}</Text>
                  {p.stock < 20 && !out ? <Text style={{ color: colors.amber, fontSize: 12, fontWeight: '600' }}>Only {p.stock} left</Text> : null}
                  {out ? <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '600' }}>Out of stock</Text> : null}
                </View>
              </View>
              <View style={ui.between}>
                {p.refillPrice ? (
                  <View style={styles.toggle}>
                    {[{ v: true, l: `Refill ${kes(p.refillPrice)}` }, { v: false, l: `New ${kes(p.price)}` }].map((o) => (
                      <Pressable key={String(o.v)} onPress={() => update(p.id, { refill: o.v })} style={[styles.toggleOpt, item.refill === o.v && styles.toggleOn]}>
                        <Text style={[styles.toggleText, item.refill === o.v && { color: colors.primaryDeep }]}>{o.l}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : <View />}
                <Stepper value={item.qty} max={p.stock} onChange={(qty) => update(p.id, { qty, refill: item.refill })} />
              </View>
            </Card>
          );
        })}
      </Screen>

      {count ? (
        <View style={styles.cartBar}>
          <View style={{ flex: 1 }}>
            <Text style={type.bodySm}>{count} item{count > 1 ? 's' : ''}</Text>
            <Text style={[type.headline, type.num]}>{kes(total)}</Text>
          </View>
          <Button title="Checkout" icon="arrow-forward" onPress={openCheckout} />
        </View>
      ) : null}

      <Sheet visible={checkout} onClose={() => setCheckout(false)} title="Checkout" subtitle="Where to deliver, and how you'll pay"
        footer={<View style={{ gap: 6 }}>
          {formError ? <Text style={{ color: colors.danger, textAlign: 'center' }}>{formError}</Text> : null}
          <Button title={payMethod === 'mpesa' ? `Pay ${kes(snap.total)} with M-Pesa` : `Place order · ${kes(snap.total)}`}
            icon={payMethod === 'mpesa' ? 'phone-portrait' : 'checkmark'} variant="mpesa" onPress={placeOrder} loading={placing} disabled={!snap.lines.length} />
        </View>}>
        <View style={ui.inset}>
          {snap.lines.map((l) => (
            <View key={l.p.id} style={ui.between}>
              <Text style={[type.body, { flex: 1 }]}>{l.qty}× {l.p.name}{l.refill && l.p.refillPrice ? ' (refill)' : ''}</Text>
              <Text style={[type.label, type.num]}>{kes(l.qty * priceOf(l.p, l.refill))}</Text>
            </View>
          ))}
          <View style={[ui.between, { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 8 }]}>
            <Text style={type.title}>Total</Text>
            <Text style={[type.title, type.num, { color: colors.primaryDeep }]}>{kes(snap.total)}</Text>
          </View>
        </View>
        <Text style={type.caption}>Delivery</Text>
        <Field label="Delivery address" placeholder="Estate, street, house / gate number" value={address} onChangeText={setAddress} />
        <LocationPicker value={spot} onChange={setSpot} />
        <Field label="Notes for the rider (optional)" placeholder="Call when at the gate" value={notes} onChangeText={setNotes} />

        <Text style={type.caption}>Payment</Text>
        <ChoiceGrid columns={2} value={payMethod} onChange={setPayMethod} options={[
          { value: 'mpesa', label: 'M-Pesa', sub: 'PIN prompt on phone' },
          { value: 'cash', label: 'Cash', sub: 'Pay on delivery' },
        ]} />
        {payMethod === 'mpesa' ? (
          <View style={styles.payBox}>
            <Field label="M-Pesa number to charge" placeholder="0712 345 678" keyboardType="phone-pad" value={payPhone} onChangeText={setPayPhone} />
            <Text style={type.bodySm}>
              We will send an M-Pesa prompt to this number for {kes(snap.total)}. Enter your PIN on the phone to pay Till {data?.settings?.tillNumber}.
            </Text>
          </View>
        ) : (
          <Text style={type.bodySm}>Pay the rider when your water arrives. You can still pay by M-Pesa later from My Orders.</Text>
        )}
      </Sheet>

      <PaymentSheet
        visible={Boolean(paying)}
        onClose={() => { setPaying(null); goToOrders?.(); }}
        target={paying ? { orderId: paying.order.id, amount: paying.order.total, description: `Order ${paying.order.id}` } : null}
        startedPayment={paying?.payment ?? undefined}
        startError={paying?.error}
        defaultPhone={payPhone}
        title="Order placed: pay with M-Pesa"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hello: { color: colors.cyanSoft, fontSize: 15, fontWeight: '600' },
  heroTitle: { color: colors.onPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.6, maxWidth: 280 },
  payBox: { gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.mintSoft },
  bottle: { width: 76, height: 86, borderRadius: radius.lg, backgroundColor: colors.surfaceLow, alignItems: 'center', justifyContent: 'center' },
  size: { fontSize: 11, fontWeight: '700', color: colors.primaryDeep, marginTop: 2 },
  toggle: { flexDirection: 'row', backgroundColor: colors.surfaceMid, borderRadius: radius.sm, padding: 3 },
  toggleOpt: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6 },
  toggleOn: { backgroundColor: colors.surface },
  toggleText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  cartBar: {
    position: 'absolute', left: space.md, right: space.md, bottom: space.md, backgroundColor: colors.surface, borderRadius: radius.xl,
    padding: 12, paddingLeft: 18, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: 'rgba(0,180,216,0.4)', ...shadowStrong,
  },
});
