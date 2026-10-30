import { useState } from 'react';
import { Text, View } from 'react-native';
import { useApp } from '../../AppContext';
import { colors, type } from '../../theme';
import { timeAgo } from '../../format';
import { Badge, Button, Card, ChoiceGrid, Field, Screen, SectionHeader, Stars, ui } from '../../components/ui';

const CATEGORIES = ['Water quality', 'Delivery', 'Payment', 'Customer service', 'Other'];

export default function CustomerFeedbackScreen() {
  const { data, act } = useApp();
  const [rating, setRating] = useState(5);
  const [category, setCategory] = useState('Water quality');
  const [message, setMessage] = useState('');
  const [location, setLocation] = useState('');
  const [orderId, setOrderId] = useState(null);
  const mine = data?.feedback ?? [];
  const recentOrders = (data?.orders ?? []).slice(0, 4);

  const submit = async () => {
    const ok = await act((api) => api.post('/api/feedback', { rating, category, message, location, orderId }), 'Asante! Your feedback has been sent.');
    if (ok) { setMessage(''); setOrderId(null); setRating(5); }
  };

  return (
    <Screen>
      <Card>
        <Text style={type.headline}>How did we do?</Text>
        <Text style={type.bodySm}>Your feedback goes straight to the operations team.</Text>
        <View style={{ alignItems: 'center', paddingVertical: 8 }}><Stars value={rating} size={36} onChange={setRating} /></View>
        <Text style={type.caption}>Topic</Text>
        <ChoiceGrid columns={3} value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
        {recentOrders.length ? (
          <>
            <Text style={type.caption}>About an order (optional)</Text>
            <ChoiceGrid columns={2} value={orderId} onChange={(v) => setOrderId((cur) => (cur === v ? null : v))} options={recentOrders.map((o) => ({ value: o.id, label: o.id, sub: timeAgo(o.createdAt) }))} />
          </>
        ) : null}
        <Field label="Your area (optional)" placeholder="e.g. Kilimani" value={location} onChangeText={setLocation} />
        <Field label="Message" multiline placeholder="Tell us about the water, the delivery or the rider…" value={message} onChangeText={setMessage} />
        <Button title="Send feedback" icon="send" onPress={submit} disabled={!message.trim()} />
      </Card>

      {mine.length ? <SectionHeader title="My feedback" icon="chatbubbles" /> : null}
      {mine.map((f) => (
        <Card key={f.id}>
          <View style={ui.between}>
            <Stars value={f.rating} size={14} />
            <Badge status={f.status} label={f.status === 'resolved' ? 'Replied' : 'Received'} />
          </View>
          <Text style={type.bodySm}>{f.category} · {timeAgo(f.createdAt)}</Text>
          <Text style={[type.body, { fontStyle: 'italic' }]}>“{f.message}”</Text>
          {f.reply ? (
            <View style={{ backgroundColor: colors.surfaceLow, borderRadius: 12, padding: 10, gap: 4, borderLeftWidth: 3, borderLeftColor: colors.primary }}>
              <Text style={[type.caption, { color: colors.primary }]}>{data?.settings?.companyName} replied</Text>
              <Text style={type.body}>{f.reply}</Text>
            </View>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
