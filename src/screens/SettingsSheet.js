import { useState } from 'react';
import { Text, View } from 'react-native';
import { confirm, useApp } from '../AppContext';
import { colors, type } from '../theme';
import { prettyPhone } from '../format';
import { Button, Field, Sheet, ui } from '../components/ui';

/** Account sheet: company settings for staff, profile for customers, sign-out for both. */
export default function SettingsSheet({ visible, onClose }) {
  const { data, session, isStaff, act, signOut, apiUrl, lastSync } = useApp();
  const [form, setForm] = useState({});
  const [wasVisible, setWasVisible] = useState(false);
  const s = data?.settings;

  // Load the form only when the sheet opens, so background refreshes don't wipe edits.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible && s) {
      setForm({
        companyName: s.companyName, hubName: s.hubName, tillNumber: s.tillNumber, supportPhone: s.supportPhone,
        bulkPricePerLitre: String(s.bulkPricePerLitre), lowLevelPercent: String(s.lowLevelPercent),
        varianceThresholdPercent: String(s.varianceThresholdPercent ?? 10),
      });
    }
  }
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => { if (await act((api) => api.patch('/api/settings', form), 'Settings saved')) onClose(); };
  const logout = async () => { if (await confirm('Sign out?', 'You can sign back in any time.', 'Sign out')) { onClose(); signOut(); } };

  return (
    <Sheet visible={visible} onClose={onClose} title={isStaff ? 'Company settings' : 'My account'}
      subtitle={`${session?.name ?? ''}${session?.phone ? ` · ${prettyPhone(session.phone)}` : ''}`}
      footer={<View style={{ gap: 8 }}>
        {isStaff ? <Button title="Save settings" icon="checkmark" onPress={save} /> : null}
        <Button title="Sign out" icon="log-out-outline" variant="danger" onPress={logout} />
      </View>}>
      {isStaff ? (
        <>
          <Field label="Company name" value={form.companyName} onChangeText={set('companyName')} />
          <Field label="Hub / branch" value={form.hubName} onChangeText={set('hubName')} />
          <View style={[ui.row, { gap: 8 }]}>
            <Field style={{ flex: 1 }} label="M-Pesa till number" keyboardType="numeric" value={form.tillNumber} onChangeText={set('tillNumber')} />
            <Field style={{ flex: 1 }} label="Support phone" keyboardType="phone-pad" value={form.supportPhone} onChangeText={set('supportPhone')} />
          </View>
          <View style={[ui.row, { gap: 8 }]}>
            <Field style={{ flex: 1 }} label="Bulk price KES/L" keyboardType="decimal-pad" value={form.bulkPricePerLitre} onChangeText={set('bulkPricePerLitre')} />
            <Field style={{ flex: 1 }} label="Low level alert %" keyboardType="numeric" value={form.lowLevelPercent} onChangeText={set('lowLevelPercent')} />
          </View>
          <Field label="Reconciliation variance limit %" keyboardType="numeric" value={form.varianceThresholdPercent} onChangeText={set('varianceThresholdPercent')} />
          <Text style={[type.bodySm, { marginTop: -10 }]}>Daily stock differences above this need a written explanation.</Text>
          <Text style={type.bodySm}>
            M-Pesa mode: <Text style={{ fontWeight: '700', color: s?.mpesaMode === 'live' ? colors.mintDeep : colors.amber }}>{s?.mpesaMode === 'live' ? 'Live (Daraja)' : 'Simulation'}</Text>.
            {' '}Daraja keys are configured on the server in server/.env.
          </Text>
        </>
      ) : (
        <View style={ui.inset}>
          <Text style={type.label}>Need help?</Text>
          <Text style={type.bodySm}>Call {s?.companyName} on {s?.supportPhone}. Pay to M-Pesa till {s?.tillNumber}.</Text>
        </View>
      )}
      <Text style={type.bodySm}>Server: {apiUrl}{lastSync ? ` · synced ${lastSync.toLocaleTimeString()}` : ''}</Text>
    </Sheet>
  );
}
