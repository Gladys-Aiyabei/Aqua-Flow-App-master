import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../AppContext';
import { colors, radius, shadowStrong, space, type } from '../../theme';
import { kes } from '../../format';
import { Badge, Button, Card, Empty, Field, Hero, Screen, SectionHeader, Sheet, Stepper, ui } from '../../components/ui';
import PaymentSheet from '../../components/PaymentSheet';

export default function ShopScreen({ goToOrders }) {
  const { data, session, act } = useApp();
  const [cart, setCart] = useState({}); // productId -> { qty, refill }
  const [checkout, setCheckout] = useState(false);
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [paying, setPaying] = useState(null);

  const products = data?.products ?? [];
  const priceOf = (p, refill) => (refill && p.refillPrice ? p.refillPrice : p.price);
  const lines = products.filter((p) => cart[p.id]?.qty > 0).map((p) => ({ p, ...cart[p.id] }));
  const total = lines.reduce((s, l) => s + l.qty * priceOf(l.p, l.refill), 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const update = (id, patch) => setCart((c) => ({ ...c, [id]: { qty: 0, refill: false, ...c[id], ...patch } }));

  const lastAddress = data?.orders?.[0]?.address;

  const placeOrder = async () => {
    const order = await act((api) => api.post('/api/orders', {
      address, notes, items: lines.map((l) => ({ productId: l.p.id, qty: l.qty, refill: l.refill })),
    }));
    if (order) {
      setCart({}); setCheckout(false); setNotes('');
      setPaying(order);
    }
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
          <Button title="Checkout" icon="arrow-forward" onPress={() => { setAddress((a) => a || lastAddress || ''); setCheckout(true); }} />
        </View>
      ) : null}

      <Sheet visible={checkout} onClose={() => setCheckout(false)} title="Checkout" subtitle="Pay with M-Pesa after placing your order"
        footer={<Button title={`Place order · ${kes(total)}`} icon="checkmark" variant="mpesa" onPress={placeOrder} disabled={!address.trim() || !count} />}>
        <View style={ui.inset}>
          {lines.map((l) => (
            <View key={l.p.id} style={ui.between}>
              <Text style={[type.body, { flex: 1 }]}>{l.qty}× {l.p.name}{l.refill && l.p.refillPrice ? ' (refill)' : ''}</Text>
              <Text style={[type.label, type.num]}>{kes(l.qty * priceOf(l.p, l.refill))}</Text>
            </View>
          ))}
          <View style={[ui.between, { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 8 }]}>
            <Text style={type.title}>Total</Text>
            <Text style={[type.title, type.num, { color: colors.primaryDeep }]}>{kes(total)}</Text>
          </View>
        </View>
        <Field label="Delivery address" placeholder="Estate, street, house / gate number" value={address} onChangeText={setAddress} />
        <Field label="Notes for the rider (optional)" placeholder="Call when at the gate" value={notes} onChangeText={setNotes} />
      </Sheet>

      <PaymentSheet
        visible={Boolean(paying)}
        onClose={() => { setPaying(null); goToOrders?.(); }}
        target={paying ? { orderId: paying.id, amount: paying.total, description: `Order ${paying.id}` } : null}
        defaultPhone={session?.phone}
        title="Order placed! Pay now"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hello: { color: colors.cyanSoft, fontSize: 15, fontWeight: '600' },
  heroTitle: { color: colors.onPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.6, maxWidth: 280 },
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
