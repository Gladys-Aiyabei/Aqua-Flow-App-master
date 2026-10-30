import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppContext';
import { colors, space, type } from '../theme';
import { kes, localPhone, prettyPhone } from '../format';
import { Button, Field, Sheet, ui } from './ui';

const POLL_MS = 3000;
const GIVE_UP_MS = 120000;

/**
 * Sends an M-Pesa STK push (PIN prompt) and follows it until Safaricom confirms.
 * `target` is { orderId } | { deliveryId } | { amount, description } (free amount, staff only).
 */
export default function PaymentSheet({ visible, onClose, target, defaultPhone, title = 'Pay with M-Pesa' }) {
  const { api, data, refresh } = useApp();
  const [phone, setPhone] = useState('');
  const [stage, setStage] = useState('form'); // form | sending | waiting | success | failed
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);
  const [wasVisible, setWasVisible] = useState(false);

  // Start from a clean form every time the sheet opens.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setPhone(localPhone(defaultPhone));
      setStage('form'); setPayment(null); setError('');
    }
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  const amount = target?.amount ?? 0;
  const till = data?.settings?.tillNumber;
  const simulated = data?.settings?.mpesaMode === 'simulation';

  const poll = (id, startedAt) => {
    timer.current = setTimeout(async () => {
      try {
        const p = await api.get(`/api/payments/${id}`);
        setPayment(p);
        if (p.status === 'success') { setStage('success'); refresh(); return; }
        if (p.status === 'failed') { setStage('failed'); setError(p.resultDesc || 'The customer cancelled or the request timed out.'); refresh(); return; }
      } catch { /* keep trying */ }
      if (Date.now() - startedAt < GIVE_UP_MS) poll(id, startedAt);
      else { setStage('failed'); setError('No confirmation yet. Check the till statement, then record the payment manually.'); }
    }, POLL_MS);
  };

  const send = async () => {
    setStage('sending'); setError('');
    try {
      const res = await api.post('/api/payments/stk', { ...target, phone });
      setPayment(res.payment);
      setStage('waiting');
      poll(res.payment.id, Date.now());
    } catch (e) {
      setStage('form'); setError(e.message);
    }
  };

  const close = () => { clearTimeout(timer.current); onClose(); };

  return (
    <Sheet visible={visible} onClose={close} title={title} subtitle={target?.description}>
      <View style={[ui.inset, { backgroundColor: colors.mintSoft }]}>
        <View style={ui.between}>
          <Text style={type.bodySm}>Amount</Text>
          <Text style={[type.metric, { color: colors.mintDeep, fontSize: 26 }]}>{amount ? kes(amount) : '—'}</Text>
        </View>
        <View style={ui.between}>
          <Text style={type.bodySm}>Paying to till</Text>
          <Text style={[type.label, type.num]}>{till}</Text>
        </View>
      </View>

      {stage === 'form' || stage === 'sending' ? (
        <>
          <Field label="M-Pesa phone number" placeholder="0712 345 678" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          <Button title="Send M-Pesa PIN prompt" icon="flash" variant="mpesa" onPress={send} loading={stage === 'sending'} />
          <Text style={[type.bodySm, { textAlign: 'center' }]}>
            Or pay manually: M-Pesa › Lipa na M-Pesa › Buy Goods › Till {till}
          </Text>
          {simulated ? <Text style={[type.bodySm, { textAlign: 'center', color: colors.amber }]}>Test mode: payments are auto-approved after ~6 seconds.</Text> : null}
        </>
      ) : null}

      {stage === 'waiting' ? (
        <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
          <ActivityIndicator size="large" color={colors.mint} />
          <Text style={type.title}>Check your phone</Text>
          <Text style={[type.bodySm, { textAlign: 'center' }]}>
            Enter your M-Pesa PIN on {prettyPhone(payment?.phone)} to approve. This screen updates automatically.
          </Text>
        </View>
      ) : null}

      {stage === 'success' ? (
        <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
          <Ionicons name="checkmark-circle" size={64} color={colors.mint} />
          <Text style={type.headline}>Payment received</Text>
          <Text style={[type.body, type.num]}>M-Pesa ref <Text style={{ fontWeight: '700' }}>{payment?.mpesaReceipt}</Text></Text>
          <Button title="Done" onPress={close} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : null}

      {stage === 'failed' ? (
        <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
          <Ionicons name="close-circle" size={64} color={colors.danger} />
          <Text style={type.headline}>Payment not completed</Text>
          <Text style={[type.bodySm, { textAlign: 'center' }]}>{error}</Text>
          <Button title="Try again" variant="mpesa" icon="refresh" onPress={() => setStage('form')} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : null}
    </Sheet>
  );
}
