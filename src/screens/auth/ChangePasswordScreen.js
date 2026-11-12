import { useState } from 'react';
import { useApp } from '../../AppContext';
import { Button, Field, Toggle } from '../../components/ui';
import AuthLayout, { Notice } from './AuthLayout';

/** Shown after a staff member logs in with the temporary password from the admin. */
export default function ChangePasswordScreen() {
  const { session, changePassword, signOut } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (busy) return;
    if (!current) { setError('Enter the temporary password you were given.'); return; }
    if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) { setError('Use at least 8 characters with a letter and a number.'); return; }
    if (next !== confirm) { setError('The two new passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      await changePassword(current, next);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <AuthLayout title="Set your own password" subtitle={`Hi ${session?.name?.split(' ')[0] ?? ''}, replace the temporary password before you continue.`}>
      <Field label="Temporary password" value={current} onChangeText={setCurrent} secureTextEntry={!show} autoCapitalize="none" autoComplete="current-password" />
      <Field label="New password" placeholder="At least 8 characters, a letter and a number" value={next} onChangeText={setNext} secureTextEntry={!show} autoCapitalize="none" autoComplete="new-password" />
      <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry={!show} autoCapitalize="none" autoComplete="new-password" onSubmitEditing={submit} />
      <Toggle label="Show passwords" value={show} onChange={setShow} />
      {error ? <Notice>{error}</Notice> : null}
      <Button title="Save new password" icon="lock-closed-outline" onPress={submit} loading={busy} />
      <Button title="Sign out" variant="ghost" icon="log-out-outline" onPress={signOut} />
    </AuthLayout>
  );
}
