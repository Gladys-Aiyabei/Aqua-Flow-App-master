import { useState } from 'react';
import { Text, View } from 'react-native';
import { useApp } from '../../AppContext';
import { colors, type } from '../../theme';
import { kes, litres, timeAgo } from '../../format';
import { Badge, Button, Card, ChoiceGrid, Field, Hero, InfoRow, Screen, SectionHeader, ui } from '../../components/ui';
import PaymentSheet from '../../components/PaymentSheet';

const STEPS = [
  { key: 'requested', label: 'Requested' },
  { key: 'scheduled', label: 'Tanker assigned' },
  { key: 'filling', label: 'Filling at depot' },
  { key: 'en_route', label: 'On the way' },
  { key: 'discharging', label: 'Offloading' },
  { key: 'delivered', label: 'Delivered' },
];

export default function BulkScreen() {
  const { data, session, act } = useApp();
  const [volume, setVolume] = useState(10000);
  const [destination, setDestination] = useState('');
  const [notes, setNotes] = useState('');
  const [paying, setPaying] = useState(null);
  const price = data?.settings?.bulkPricePerLitre ?? 0;
  const mine = data?.deliveries ?? [];

  const submit = async () => {
    const d = await act((api) => api.post('/api/deliveries', { volumeL: volume, destination, notes }), 'Request sent! We will assign a tanker shortly.');
    if (d) { setNotes(''); }
  };

  return (
    <Screen>
      <Hero>
        <Text style={{ color: colors.cyanSoft, fontWeight: '700', letterSpacing: 0.8, fontSize: 12 }}>BULK WATER BY TANKER</Text>
        <Text style={{ color: colors.onPrimary, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 }}>For homes, sites, hotels & industry</Text>
        <Text style={{ color: colors.cyanSoft }}>KES {price} per litre · treated & metered delivery</Text>
      </Hero>

      <Card>
        <Text style={type.title}>Request a tanker</Text>
        <Text style={type.caption}>How much water?</Text>
        <ChoiceGrid value={volume} onChange={setVolume} options={[
          { value: 5000, label: '5,000 L', sub: kes(5000 * price) },
          { value: 10000, label: '10,000 L', sub: kes(10000 * price) },
          { value: 18000, label: '18,000 L', sub: kes(18000 * price) },
        ]} />
        <Field label="Or enter litres" keyboardType="numeric" value={String(volume || '')} onChangeText={(v) => setVolume(Number(v.replace(/\D/g, '')) || 0)} />
        <Field label="Delivery location" placeholder="Site / estate, road, landmark" value={destination} onChangeText={setDestination} />
        <Field label="Notes (optional)" placeholder="Tank height, gate, preferred time" value={notes} onChangeText={setNotes} />
        <View style={[ui.inset, ui.between, { backgroundColor: colors.mintSoft }]}>
          <Text style={type.body}>Estimated cost</Text>
          <Text style={[type.headline, type.num, { color: colors.mintDeep }]}>{kes(volume * price)}</Text>
        </View>
        <Button title="Request tanker delivery" icon="bus" onPress={submit} disabled={!destination.trim() || volume < 500} />
      </Card>

      {mine.length ? <SectionHeader title="My tanker deliveries" icon="bus" /> : null}
      {mine.map((d) => {
        const idx = STEPS.findIndex((s) => s.key === d.status);
        return (
          <Card key={d.id}>
            <View style={ui.between}>
              <View>
                <Text style={type.title}>{d.id} · {litres(d.volumeL)}</Text>
                <Text style={type.bodySm}>{timeAgo(d.createdAt)}</Text>
              </View>
              <Badge status={d.status} />
            </View>
            <InfoRow icon="location">{d.destination}</InfoRow>
            {d.status !== 'cancelled' ? (
              <View style={{ gap: 6 }}>
                {STEPS.map((s, i) => (
                  <View key={s.key} style={[ui.row, { gap: 8 }]}>
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: i <= idx ? colors.mint : colors.surfaceHigh }} />
                    <Text style={[type.bodySm, i <= idx && { color: colors.text, fontWeight: i === idx ? '700' : '400' }]}>{s.label}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={ui.between}>
              <Text style={[type.title, type.num]}>{kes(d.amount)}</Text>
              {d.paymentStatus === 'paid'
                ? <Badge status="paid" icon="checkmark-circle" label={`Paid · ${d.mpesaRef ?? ''}`} />
                : d.status !== 'cancelled' ? <Button small title="Pay with M-Pesa" icon="phone-portrait" variant="mpesa" onPress={() => setPaying(d)} /> : null}
            </View>
          </Card>
        );
      })}

      <PaymentSheet visible={Boolean(paying)} onClose={() => setPaying(null)}
        target={paying ? { deliveryId: paying.id, amount: paying.amount, description: `Tanker ${paying.id}` } : null}
        defaultPhone={session?.phone} />
    </Screen>
  );
}
