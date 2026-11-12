import { useState } from 'react';
import { Text, View } from 'react-native';
import { confirm, notify, useApp } from '../AppContext';
import { isDevBuild } from '../api';
import { colors, type } from '../theme';
import { prettyPhone } from '../format';
import { Badge, Button, Field, Sheet, ui } from '../components/ui';

const ROLE = { admin: 'Admin', staff: 'Staff', customer: 'Customer' };

/** Account sheet: company settings (admin only), password change and sign-out for everyone. */
export default function SettingsSheet({ visible, onClose }) {
  const { data, session, isAdmin, act, signOut, changePassword, apiUrl, lastSync } = useApp();
  const [form, setForm] = useState({});
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwOpen, setPwOpen] = useState(false);
  const [wasVisible, setWasVisible] = useState(false);
  const s = data?.settings;
  const branch = (data?.branches ?? []).find((b) => b.id === session?.branchId);

  // Load the form only when the sheet opens, so background refreshes don't wipe edits.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setPw({ current: '', next: '', confirm: '' });
      setPwOpen(false);
      if (s) {
        setForm({
          companyName: s.companyName, tillNumber: s.tillNumber, supportPhone: s.supportPhone ?? '',
          bulkPricePerLitre: String(s.bulkPricePerLitre ?? ''), lowLevelPercent: String(s.lowLevelPercent ?? ''),
          varianceThresholdPercent: String(s.varianceThresholdPercent ?? 10),
        });
      }
    }
  }
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => { if (await act((api) => api.patch('/api/settings', form), 'Settings saved')) onClose(); };
  const logout = async () => { if (await confirm('Sign out?', 'You can sign back in any time.', 'Sign out')) { onClose(); signOut(); } };
  const savePassword = async () => {
    if (pw.next !== pw.confirm) { notify('Passwords do not match', 'Type the same new password twice.'); return; }
    try {
      await changePassword(pw.current, pw.next);
      notify('Password changed', 'Other devices have been signed out.');
      setPw({ current: '', next: '', confirm: '' });
      setPwOpen(false);
    } catch (e) {
      notify('Could not change password', e.message);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={isAdmin ? 'Company settings' : 'My account'}
      subtitle={`${session?.name ?? ''} · ${session?.email ?? ''}`}
      footer={<View style={{ gap: 8 }}>
        {isAdmin ? <Button title="Save settings" icon="checkmark" onPress={save} /> : null}
        <Button title="Sign out" icon="log-out-outline" variant="danger" onPress={logout} />
      </View>}>
      <View style={[ui.inset, { gap: 6 }]}>
        <View style={ui.between}>
          <Text style={type.label}>Signed in as</Text>
          <Badge label={ROLE[session?.role] ?? ''} />
        </View>
        {session?.phone ? <Text style={type.bodySm}>Phone: {prettyPhone(session.phone)}</Text> : null}
        {session?.role !== 'admin' ? <Text style={type.bodySm}>{session?.role === 'staff' ? 'Branch' : 'Delivery area'}: {branch ? `${branch.code} · ${branch.name}` : '—'}</Text> : <Text style={type.bodySm}>Access: all branches</Text>}
      </View>

      {isAdmin ? (
        <>
          <Field label="Company name" value={form.companyName} onChangeText={set('companyName')} />
          <View style={[ui.row, { gap: 8 }]}>
            <Field style={{ flex: 1 }} label="M-Pesa till number" keyboardType="numeric" value={form.tillNumber} onChangeText={set('tillNumber')} />
            <Field style={{ flex: 1 }} label="Support phone" keyboardType="phone-pad" value={form.supportPhone} onChangeText={set('supportPhone')} />
          </View>
          <View style={[ui.row, { gap: 8 }]}>
            <Field style={{ flex: 1 }} label="Bulk price KES/L" keyboardType="decimal-pad" value={form.bulkPricePerLitre} onChangeText={set('bulkPricePerLitre')} />
            <Field style={{ flex: 1 }} label="Low level alert %" keyboardType="numeric" value={form.lowLevelPercent} onChangeText={set('lowLevelPercent')} />
          </View>
          <Field label="Reconciliation variance limit %" keyboardType="numeric" value={form.varianceThresholdPercent} onChangeText={set('varianceThresholdPercent')} />
          <Text style={type.bodySm}>
            M-Pesa: <Text style={{ fontWeight: '700', color: s?.mpesaMode === 'live' ? colors.mintDeep : colors.amber }}>{s?.mpesaMode === 'live' ? 'Live (PayHero)' : 'Test mode'}</Text>.
            {' '}PayHero keys are set on the server (Netlify environment variables).
          </Text>
        </>
      ) : session?.role === 'customer' ? (
        <View style={ui.inset}>
          <Text style={type.label}>Need help?</Text>
          <Text style={type.bodySm}>Call {s?.companyName} on {s?.supportPhone ? prettyPhone(s.supportPhone) : 'our support line'}. Pay to M-Pesa till {s?.tillNumber}.</Text>
        </View>
      ) : null}

      {pwOpen ? (
        <View style={{ gap: 10 }}>
          <Field label="Current password" secureTextEntry value={pw.current} onChangeText={(v) => setPw((p) => ({ ...p, current: v }))} autoCapitalize="none" />
          <Field label="New password" placeholder="8+ characters, a letter and a number" secureTextEntry value={pw.next} onChangeText={(v) => setPw((p) => ({ ...p, next: v }))} autoCapitalize="none" />
          <Field label="Confirm new password" secureTextEntry value={pw.confirm} onChangeText={(v) => setPw((p) => ({ ...p, confirm: v }))} autoCapitalize="none" />
          <Button title="Change password" icon="lock-closed-outline" variant="outline" onPress={savePassword} disabled={!pw.current || !pw.next} />
        </View>
      ) : <Button title="Change password" icon="key-outline" variant="ghost" onPress={() => setPwOpen(true)} />}

      {isDevBuild ? <Text style={type.bodySm}>Server: {apiUrl}{lastSync ? ` · synced ${lastSync.toLocaleTimeString()}` : ''}</Text> : null}
    </Sheet>
  );
}
