import { useState } from 'react';
import { Text, View } from 'react-native';
import { notify, useApp } from '../../AppContext';
import { colors, type } from '../../theme';
import { isValidKenyanPhone, kes, litres, localPhone, timeAgo } from '../../format';
import { Badge, Button, Card, ChoiceGrid, Field, Hero, InfoRow, Screen, SectionHeader, ui } from '../../components/ui';
import PaymentSheet from '../../components/PaymentSheet';
import LocationPicker from '../../components/LocationPicker';
import MapEmbed from '../../components/MapEmbed';
import DeliveryAreaCard, { useDeliveryArea } from '../../components/DeliveryAreaCard';

const STEPS = [
  { key: 'requested', label: 'Requested' },
  { key: 'scheduled', label: 'Tanker assigned' },
  { key: 'filling', label: 'Filling at depot' },
  { key: 'en_route', label: 'On the way' },
  { key: 'discharging', label: 'Offloading' },
  { key: 'delivered', label: 'Delivered' },
];

export default function BulkScreen() {
  const { data, session, act, api } = useApp();
  const [volume, setVolume] = useState(10000);
  const [payMethod, setPayMethod] = useState('mpesa');
  const [payPhone, setPayPhone] = useState(() => localPhone(session?.phone));
  const [sending, setSending] = useState(false);
  const [destination, setDestination] = useState('');
  const [notes, setNotes] = useState('');
  const [spot, setSpot] = useState(null);
  const [showMap, setShowMap] = useState(false);
  const [paying, setPaying] = useState(null);
  const { hasArea } = useDeliveryArea();
  const price = data?.settings?.bulkPricePerLitre ?? 0;
  const mine = data?.deliveries ?? [];

  const submit = async () => {
    if (sending) return;
    if (!hasArea) { notify('Choose your delivery area', 'Pick your area in the card above first.'); return; }
    if (!(volume >= 500)) { notify('How much water?', 'Tanker deliveries start at 500 litres.'); return; }
    if (!destination.trim() && !spot) { notify('Where to deliver?', 'Type the site or estate, or tap "Use my current location".'); return; }
    if (payMethod === 'mpesa' && !isValidKenyanPhone(payPhone)) { notify('M-Pesa number needed', 'Enter the number to charge, e.g. 0712 345 678.'); return; }
    setSending(true);
    const d = await act((a) => a.post('/api/deliveries', { volumeL: volume, destination: destination.trim() || 'Pinned location', notes, ...(spot ?? {}) }));
    if (!d) { setSending(false); return; }
    setNotes(''); setSpot(null); setShowMap(false);
    if (payMethod === 'later') {
      setSending(false);
      notify('Request sent', `Tanker ${d.id} is with the team. You can pay ${kes(d.amount)} by M-Pesa from here or My Orders any time.`);
      return;
    }
    // Pay now: send the M-Pesa prompt straight away.
    try {
      const res = await api.post('/api/payments/stk', { deliveryId: d.id, phone: payPhone });
      setPaying({ delivery: d, payment: res.payment });
    } catch (e) {
      setPaying({ delivery: d, payment: null, error: e.message });
    }
    setSending(false);
  };

  return (
    <Screen>
      <Hero>
        <Text style={{ color: colors.cyanSoft, fontWeight: '700', letterSpacing: 0.8, fontSize: 12 }}>BULK WATER BY TANKER</Text>
        <Text style={{ color: colors.onPrimary, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 }}>For homes, sites, hotels & industry</Text>
        <Text style={{ color: colors.cyanSoft }}>KES {price} per litre · treated & metered delivery</Text>
      </Hero>

      <DeliveryAreaCard />

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
        <LocationPicker value={spot} onChange={setSpot} />
        {spot || showMap ? <MapEmbed latitude={spot?.latitude} longitude={spot?.longitude} address={destination} height={170} /> : null}
        {!spot && destination.trim().length > 3 ? (
          <Button small variant="ghost" icon="map-outline" title={showMap ? 'Hide map' : 'Check this address on the map'} onPress={() => setShowMap((v) => !v)} />
        ) : null}
        <Field label="Notes (optional)" placeholder="Tank height, gate, preferred time" value={notes} onChangeText={setNotes} />
        <View style={[ui.inset, ui.between, { backgroundColor: colors.mintSoft }]}>
          <Text style={type.body}>Estimated cost</Text>
          <Text style={[type.headline, type.num, { color: colors.mintDeep }]}>{kes(volume * price)}</Text>
        </View>

        <Text style={type.caption}>Payment</Text>
        <ChoiceGrid columns={2} value={payMethod} onChange={setPayMethod} options={[
          { value: 'mpesa', label: 'Pay now', sub: 'M-Pesa PIN prompt' },
          { value: 'later', label: 'Pay later', sub: 'From My Orders' },
        ]} />
        {payMethod === 'mpesa' ? (
          <View style={{ gap: 8, padding: 12, borderRadius: 12, backgroundColor: colors.mintSoft }}>
            <Field label="M-Pesa number to charge" placeholder="0712 345 678" keyboardType="phone-pad" value={payPhone} onChangeText={setPayPhone} />
            <Text style={type.bodySm}>We will send an M-Pesa prompt for {kes(volume * price)} to this number. Enter your PIN to pay Till {data?.settings?.tillNumber}.</Text>
          </View>
        ) : null}
        <Button title={payMethod === 'mpesa' ? `Request & pay ${kes(volume * price)}` : 'Request tanker delivery'}
          icon={payMethod === 'mpesa' ? 'phone-portrait' : 'bus'} variant={payMethod === 'mpesa' ? 'mpesa' : 'primary'} onPress={submit} loading={sending} />
        {!hasArea ? <Text style={[type.bodySm, { textAlign: 'center', color: colors.amber }]}>Choose your delivery area above first.</Text> : null}
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
                : d.status !== 'cancelled' ? <Button small title={`Pay ${kes(d.amount)}`} icon="phone-portrait" variant="mpesa" onPress={() => setPaying({ delivery: d })} /> : null}
            </View>
          </Card>
        );
      })}

      <PaymentSheet visible={Boolean(paying)} onClose={() => setPaying(null)}
        target={paying ? { deliveryId: paying.delivery.id, amount: paying.delivery.amount, description: `Tanker ${paying.delivery.id}` } : null}
        startedPayment={paying?.payment ?? undefined} startError={paying?.error}
        defaultPhone={payPhone} title="Pay for your tanker" />
    </Screen>
  );
}
