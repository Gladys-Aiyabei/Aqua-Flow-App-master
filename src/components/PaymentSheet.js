import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppContext';
import { colors, space, type } from '../theme';
import { isValidKenyanPhone, kes, localPhone, prettyPhone } from '../format';
import { Button, Field, Sheet, ui } from './ui';

const POLL_MS = 3000;
const GIVE_UP_MS = 120000;

/**
 * Sends an M-Pesa STK push (PIN prompt) and follows it until Safaricom confirms.
 * `target` is { orderId } | { deliveryId } | { amount, description } (free amount, staff only).
 * `startedPayment`: a prompt that was already sent (e.g. right after checkout); the sheet opens waiting for it.
 */
export default function PaymentSheet({ visible, onClose, target, defaultPhone, title = 'Pay with M-Pesa', startedPayment, startError }) {
  const { api, data, refresh } = useApp();
  const [phone, setPhone] = useState('');
  const [stage, setStage] = useState('form'); // form | sending | waiting | success | failed
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState('');
  const [wasVisible, setWasVisible] = useState(false);

  // Start fresh every time the sheet opens.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setPhone(localPhone(startedPayment?.phone ?? defaultPhone));
      setPayment(startedPayment ?? null);
      setStage(startedPayment ? 'waiting' : 'form');
      setError(startError || '');
    }
  }

  // Follow the prompt until M-Pesa answers (each answer triggers the next check).
  useEffect(() => {
    if (!visible || stage !== 'waiting' || !payment?.id) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const p = await api.get(`/api/payments/${payment.id}`);
        if (cancelled) return;
        if (p.status === 'success') { setPayment(p); setStage('success'); refresh(); return; }
        if (p.status === 'failed') {
          setPayment(p); setStage('failed'); setError(p.resultDesc || 'The prompt was cancelled or timed out.'); refresh(); return;
        }
        if (Date.now() - (Date.parse(p.createdAt) || Date.now()) > GIVE_UP_MS) {
          setStage('failed'); setError('No confirmation yet. If money left your M-Pesa, it will show here once confirmed.'); return;
        }
        setPayment(p);
      } catch {
        if (!cancelled) setPayment((x) => ({ ...x })); // network blip: try again
      }
    }, POLL_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [visible, stage, payment, api, refresh]);

  const amount = target?.amount ?? 0;
  const till = data?.settings?.tillNumber;
  const simulated = data?.settings?.mpesaMode !== 'live';

  const send = async () => {
    if (!isValidKenyanPhone(phone)) { setError('Enter the M-Pesa number to send the prompt to, e.g. 0712 345 678.'); return; }
    setStage('sending'); setError('');
    try {
      const res = await api.post('/api/payments/stk', { ...target, phone });
      setPayment(res.payment);
      setStage('waiting');
    } catch (e) {
      setStage('form'); setError(e.message);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={target?.description}>
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
          <Field label="M-Pesa number to charge" placeholder="0712 345 678" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          <Button title={`Send M-Pesa prompt · ${amount ? kes(amount) : ''}`} icon="flash" variant="mpesa" onPress={send} loading={stage === 'sending'} />
          <Text style={[type.bodySm, { textAlign: 'center' }]}>
            Or pay manually: M-Pesa › Lipa na M-Pesa › Buy Goods › Till {till}
          </Text>
          {simulated ? <Text style={[type.bodySm, { textAlign: 'center', color: colors.amber }]}>Test mode: payments are approved automatically after a few seconds.</Text> : null}
        </>
      ) : null}

      {stage === 'waiting' ? (
        <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
          <ActivityIndicator size="large" color={colors.mint} />
          <Text style={type.title}>Check your phone</Text>
          <Text style={[type.bodySm, { textAlign: 'center' }]}>
            Enter your M-Pesa PIN on {prettyPhone(payment?.phone)} to approve {amount ? kes(amount) : 'the payment'}. This screen updates by itself.
          </Text>
          <Button small variant="ghost" title="Use a different number" onPress={() => { setStage('form'); setPayment(null); }} />
        </View>
      ) : null}

      {stage === 'success' ? (
        <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
          <Ionicons name="checkmark-circle" size={64} color={colors.mint} />
          <Text style={type.headline}>Payment received</Text>
          <Text style={[type.body, type.num]}>M-Pesa ref <Text style={{ fontWeight: '700' }}>{payment?.mpesaReceipt}</Text></Text>
          <Button title="Done" onPress={onClose} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : null}

      {stage === 'failed' ? (
        <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
          <Ionicons name="close-circle" size={64} color={colors.danger} />
          <Text style={type.headline}>Payment not completed</Text>
          <Text style={[type.bodySm, { textAlign: 'center' }]}>{error}</Text>
          <Button title="Try again" variant="mpesa" icon="refresh" onPress={() => { setStage('form'); setPayment(null); }} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : null}
    </Sheet>
  );
}
