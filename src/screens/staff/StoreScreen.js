import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { confirm, useApp } from '../../AppContext';
import { colors, radius, type } from '../../theme';
import { isToday, kes, prettyPhone, timeAgo } from '../../format';
import {
  Badge, Button, Card, Empty, Field, Hero, HeroStat, IconButton, InfoRow, Screen, SectionHeader, Segmented, Sheet, Stepper, Toggle, ui,
} from '../../components/ui';
import PaymentSheet from '../../components/PaymentSheet';

const LOW_STOCK = 20;
const ACCENT = { new: colors.primary, confirmed: colors.primaryDeep, dispatched: colors.cyan, delivered: colors.mintDeep, cancelled: colors.danger };

export default function StoreScreen() {
  const { data, act } = useApp();
  const [filter, setFilter] = useState('open');
  const [productForm, setProductForm] = useState(null);
  const [restock, setRestock] = useState(null);
  const [dispatching, setDispatching] = useState(null);
  const [walkIn, setWalkIn] = useState(false);
  const [paying, setPaying] = useState(null);

  const products = data?.products ?? [];
  const orders = data?.orders ?? [];
  const todays = orders.filter((o) => isToday(o.createdAt) && o.status !== 'cancelled');
  const sales = todays.filter((o) => o.paymentStatus === 'paid').reduce((s, o) => s + o.total, 0);
  const byStatus = (st) => orders.filter((o) => o.status === st);
  const lists = {
    open: orders.filter((o) => ['new', 'confirmed', 'dispatched'].includes(o.status)),
    new: byStatus('new'), dispatched: byStatus('dispatched'), delivered: byStatus('delivered'), cancelled: byStatus('cancelled'),
  };

  const setStatus = (o, status) => act((api) => api.patch(`/api/orders/${o.id}`, { status }));
  const cancel = async (o) => {
    if (await confirm('Cancel order?', `${o.id} will be cancelled and stock returned.`, 'Cancel order')) setStatus(o, 'cancelled');
  };
  const markCash = async (o) => {
    if (await confirm('Mark as paid in cash?', `${kes(o.total)} received in cash for ${o.id}.`, 'Mark paid')) act((api) => api.patch(`/api/orders/${o.id}`, { paidCash: true }));
  };

  return (
    <Screen>
      <Hero>
        <Text style={styles.caption}>TODAY’S PAID SALES</Text>
        <Text style={styles.value}>{kes(sales)}</Text>
        <View style={[ui.row, { gap: 8 }]}>
          <HeroStat label="Orders today" icon="bag-handle" value={todays.length} />
          <HeroStat label="To fulfil" icon="time" value={lists.open.length} />
          <HeroStat label="Unpaid" icon="alert-circle" value={orders.filter((o) => o.paymentStatus !== 'paid' && o.status !== 'cancelled').length} />
        </View>
      </Hero>

      <SectionHeader title="Packaged Water Store" subtitle="Live hub inventory" icon="cube" action="Add product" onAction={() => setProductForm({})} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16 }} style={{ marginHorizontal: -16, paddingLeft: 16 }}>
        {products.map((p) => {
          const low = p.stock < LOW_STOCK;
          return (
            <Card key={p.id} style={[styles.product, !p.active && { opacity: 0.5 }]}>
              <View style={ui.between}>
                <Badge label={`${p.stock} in stock`} color={low ? colors.danger : colors.mintDeep} bg={low ? colors.dangerSoft : colors.mintSoft} />
                <IconButton icon="options-outline" label="Edit product" onPress={() => setProductForm(p)} />
              </View>
              <View style={styles.bottle}>
                <Ionicons name="water" size={42} color={colors.primary} />
                <View style={styles.size}><Text style={{ color: colors.primaryDeep, fontWeight: '700', fontSize: 12 }}>{p.size}</Text></View>
              </View>
              <Text style={type.title} numberOfLines={1}>{p.name}</Text>
              <Text style={type.bodySm} numberOfLines={1}>{p.description}</Text>
              <View style={ui.inset}>
                <View style={ui.between}><Text style={type.bodySm}>New</Text><Text style={[type.label, type.num, { color: colors.primary }]}>{kes(p.price)}</Text></View>
                {p.refillPrice ? <View style={ui.between}><Text style={type.bodySm}>Refill</Text><Text style={[type.label, type.num, { color: colors.primary }]}>{kes(p.refillPrice)}</Text></View> : null}
              </View>
              <Button small title="Restock" icon="add-circle" onPress={() => setRestock(p)} />
            </Card>
          );
        })}
        {products.length === 0 ? <View style={{ width: 300 }}><Empty icon="cube-outline" title="No products" text="Add your bottled and jar products." /></View> : null}
      </ScrollView>

      <SectionHeader title="Customer Orders" subtitle="Orders from the customer app & counter" icon="receipt" />
      <Button title="Walk-in / phone order" icon="add" variant="mpesa" onPress={() => setWalkIn(true)} />
      <Segmented value={filter} onChange={setFilter} options={[
        { value: 'open', label: 'Open', count: lists.open.length },
        { value: 'new', label: 'New', count: lists.new.length },
        { value: 'dispatched', label: 'In transit', count: lists.dispatched.length },
        { value: 'delivered', label: 'Delivered', count: lists.delivered.length },
        { value: 'cancelled', label: 'Cancelled', count: lists.cancelled.length },
      ]} />

      {lists[filter].length === 0 ? <Empty icon="receipt-outline" title="No orders here" text="New customer orders appear automatically." /> : null}
      {lists[filter].map((o) => (
        <Card key={o.id} accent={ACCENT[o.status]}>
          <View style={ui.between}>
            <View style={{ flex: 1 }}>
              <View style={[ui.row, { gap: 8, flexWrap: 'wrap' }]}>
                <Text style={type.title}>#{o.id}</Text>
                <Badge status={o.status} />
              </View>
              <Text style={type.bodySm}>{o.customerName} · {timeAgo(o.createdAt)}{o.source === 'walk_in' ? ' · counter' : ''}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[type.headline, type.num, { color: colors.primaryDeep }]}>{kes(o.total)}</Text>
              {o.paymentStatus === 'paid'
                ? <Text style={{ color: colors.mintDeep, fontSize: 12, fontWeight: '600' }}>✓ Paid ({o.paymentMethod === 'cash' ? 'Cash' : 'M-Pesa'})</Text>
                : <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '600' }}>Unpaid</Text>}
            </View>
          </View>
          <View style={ui.inset}>
            {o.items.map((i) => (
              <View key={i.productId + i.refill} style={ui.between}>
                <Text style={[type.body, { flex: 1 }]}>{i.qty}× {i.name}</Text>
                <Text style={[type.bodySm, type.num]}>{kes(i.qty * i.unitPrice)}</Text>
              </View>
            ))}
          </View>
          <InfoRow icon="location">{o.address}</InfoRow>
          {o.customerPhone ? <InfoRow icon="call">{prettyPhone(o.customerPhone)}</InfoRow> : null}
          {o.rider ? <InfoRow icon="bicycle">Rider: {o.rider}</InfoRow> : null}
          {o.mpesaRef ? <Badge status="paid" icon="checkmark-circle" label={`M-Pesa ${o.mpesaRef}`} /> : null}

          <View style={ui.actions}>
            {o.status === 'new' ? <Button small title="Confirm" icon="checkmark" variant="ghost" onPress={() => setStatus(o, 'confirmed')} style={{ flex: 1 }} /> : null}
            {['new', 'confirmed'].includes(o.status) ? <Button small title="Assign rider" icon="bicycle" onPress={() => setDispatching(o)} style={{ flex: 1 }} /> : null}
            {o.status === 'dispatched' ? <Button small title="Mark delivered" icon="checkmark-done" onPress={() => setStatus(o, 'delivered')} style={{ flex: 1 }} /> : null}
            {o.customerPhone ? <IconButton icon="call" label="Call customer" onPress={() => Linking.openURL(`tel:+${o.customerPhone}`)} /> : null}
          </View>
          {o.paymentStatus !== 'paid' && o.status !== 'cancelled' ? (
            <View style={ui.actions}>
              <Button small title="M-Pesa prompt" icon="phone-portrait" variant="mpesa" onPress={() => setPaying(o)} style={{ flex: 1 }} />
              <Button small title="Cash received" icon="cash" variant="ghost" onPress={() => markCash(o)} style={{ flex: 1 }} />
            </View>
          ) : null}
          {['new', 'confirmed'].includes(o.status) ? <Button small title="Cancel order" variant="danger" icon="close" onPress={() => cancel(o)} /> : null}
        </Card>
      ))}

      <ProductSheet product={productForm} onClose={() => setProductForm(null)} />
      <RestockSheet product={restock} onClose={() => setRestock(null)} />
      <RiderSheet order={dispatching} onClose={() => setDispatching(null)} />
      <WalkInSheet visible={walkIn} onClose={() => setWalkIn(false)} onCreated={(o) => { if (o.paymentStatus !== 'paid') setPaying(o); }} />
      <PaymentSheet visible={Boolean(paying)} onClose={() => setPaying(null)} title="Request M-Pesa payment"
        target={paying ? { orderId: paying.id, amount: paying.total, description: `Order ${paying.id} · ${paying.customerName}` } : null}
        defaultPhone={paying?.customerPhone} />
    </Screen>
  );
}

function useFormFor(item, init) {
  const [form, setForm] = useState({});
  const [key, setKey] = useState(null);
  const k = item ? item.id ?? 'new' : null;
  if (k !== key) { setKey(k); setForm(item ? init(item) : {}); }
  return [form, (f) => (v) => setForm((s) => ({ ...s, [f]: v })), setForm];
}

function ProductSheet({ product, onClose }) {
  const { act } = useApp();
  const isNew = product && !product.id;
  const [form, set] = useFormFor(product, (p) => ({
    name: p.name ?? '', size: p.size ?? '', description: p.description ?? '', price: p.price ? String(p.price) : '',
    refillPrice: p.refillPrice ? String(p.refillPrice) : '', stock: p.stock !== undefined ? String(p.stock) : '', active: p.active ?? true,
  }));
  const save = async () => {
    if (await act((api) => (isNew ? api.post('/api/products', form) : api.patch(`/api/products/${product.id}`, form)))) onClose();
  };
  const remove = async () => {
    if (await confirm('Delete product?', `${product.name} will be removed from the store.`, 'Delete')) {
      if (await act((api) => api.del(`/api/products/${product.id}`))) onClose();
    }
  };
  return (
    <Sheet visible={Boolean(product)} onClose={onClose} title={isNew ? 'Add product' : 'Edit product'}
      footer={<View style={{ gap: 8 }}>
        <Button title="Save product" icon="checkmark" onPress={save} />
        {!isNew ? <Button title="Delete product" variant="danger" icon="trash-outline" onPress={remove} /> : null}
      </View>}>
      <Field label="Product name" placeholder="20L Mineral Dispenser" value={form.name} onChangeText={set('name')} />
      <View style={[ui.row, { gap: 8 }]}>
        <Field style={{ flex: 1 }} label="Size" placeholder="20L" value={form.size} onChangeText={set('size')} />
        <Field style={{ flex: 1 }} label="Stock" keyboardType="numeric" value={form.stock} onChangeText={set('stock')} />
      </View>
      <Field label="Description" placeholder="Refill or new jar" value={form.description} onChangeText={set('description')} />
      <View style={[ui.row, { gap: 8 }]}>
        <Field style={{ flex: 1 }} label="Price (KES)" keyboardType="numeric" value={form.price} onChangeText={set('price')} />
        <Field style={{ flex: 1 }} label="Refill price" placeholder="optional" keyboardType="numeric" value={form.refillPrice} onChangeText={set('refillPrice')} />
      </View>
      <Toggle label="Visible to customers" value={form.active} onChange={set('active')} />
    </Sheet>
  );
}

function RestockSheet({ product, onClose }) {
  const { act } = useApp();
  const [qty, setQty] = useState('');
  const save = async () => {
    if (await act((api) => api.patch(`/api/products/${product.id}`, { restock: Number(qty) }), `Added ${qty} × ${product.name}`)) { setQty(''); onClose(); }
  };
  return (
    <Sheet visible={Boolean(product)} onClose={onClose} title="Restock" subtitle={product ? `${product.name} · ${product.stock} in stock` : ''}
      footer={<Button title="Add to stock" icon="add-circle" onPress={save} disabled={!Number(qty)} />}>
      <Field label="Units received" keyboardType="numeric" value={qty} onChangeText={setQty} placeholder="e.g. 100" autoFocus />
    </Sheet>
  );
}

function RiderSheet({ order, onClose }) {
  const { act } = useApp();
  const [rider, setRider] = useState('');
  const save = async () => {
    if (await act((api) => api.patch(`/api/orders/${order.id}`, { rider, status: 'dispatched' }))) { setRider(''); onClose(); }
  };
  return (
    <Sheet visible={Boolean(order)} onClose={onClose} title="Dispatch order" subtitle={order ? `${order.id} → ${order.address}` : ''}
      footer={<Button title="Dispatch" icon="bicycle" onPress={save} disabled={!rider.trim()} />}>
      <Field label="Rider / van" placeholder="Kevin Mwangi · KMEF 814Z" value={rider} onChangeText={setRider} autoFocus />
    </Sheet>
  );
}

function WalkInSheet({ visible, onClose, onCreated }) {
  const { data, act } = useApp();
  const [cart, setCart] = useState({});
  const [refill, setRefill] = useState({});
  const [customer, setCustomer] = useState({ customerName: '', customerPhone: '', address: '' });
  const [paidCash, setPaidCash] = useState(false);
  const products = (data?.products ?? []).filter((p) => p.active);
  const total = products.reduce((s, p) => s + (cart[p.id] || 0) * (refill[p.id] && p.refillPrice ? p.refillPrice : p.price), 0);

  const reset = () => { setCart({}); setRefill({}); setCustomer({ customerName: '', customerPhone: '', address: '' }); setPaidCash(false); };
  const submit = async () => {
    const items = Object.entries(cart).filter(([, q]) => q > 0).map(([productId, qty]) => ({ productId, qty, refill: Boolean(refill[productId]) }));
    const order = await act((api) => api.post('/api/orders', { ...customer, items, paidCash }));
    if (order) { reset(); onClose(); onCreated(order); }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Walk-in / phone order" subtitle="Counter sale or order taken by phone"
      footer={<Button title={`Create order · ${kes(total)}`} icon="checkmark" variant="mpesa" onPress={submit} disabled={!total} />}>
      {products.map((p) => (
        <View key={p.id} style={[ui.between, styles.line]}>
          <View style={{ flex: 1 }}>
            <Text style={type.label}>{p.name}</Text>
            <Text style={type.bodySm}>{kes(refill[p.id] && p.refillPrice ? p.refillPrice : p.price)} · {p.stock} left</Text>
            {p.refillPrice ? <Toggle label="Refill" value={Boolean(refill[p.id])} onChange={(v) => setRefill((r) => ({ ...r, [p.id]: v }))} /> : null}
          </View>
          <Stepper value={cart[p.id] || 0} max={p.stock} onChange={(v) => setCart((c) => ({ ...c, [p.id]: v }))} />
        </View>
      ))}
      <Field label="Customer name" value={customer.customerName} onChangeText={(v) => setCustomer((c) => ({ ...c, customerName: v }))} />
      <Field label="Phone (for M-Pesa)" keyboardType="phone-pad" placeholder="0712 345 678" value={customer.customerPhone} onChangeText={(v) => setCustomer((c) => ({ ...c, customerPhone: v }))} />
      <Field label="Delivery address" placeholder="Leave blank for counter pickup" value={customer.address} onChangeText={(v) => setCustomer((c) => ({ ...c, address: v }))} />
      <Toggle label="Customer paid cash now" value={paidCash} onChange={setPaidCash} />
      {!paidCash ? <Text style={type.bodySm}>After creating, you can send an M-Pesa prompt to the customer’s phone.</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  caption: { color: colors.cyanSoft, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  value: { color: colors.onPrimary, fontSize: 36, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  product: { width: 240, gap: 8 },
  bottle: { height: 96, borderRadius: radius.lg, backgroundColor: colors.surfaceLow, alignItems: 'center', justifyContent: 'center' },
  size: { position: 'absolute', right: 10, bottom: 10, backgroundColor: colors.cyanSoft, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2 },
  line: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
});
