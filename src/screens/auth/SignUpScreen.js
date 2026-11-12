import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { useApp } from '../../AppContext';
import { isValidKenyanPhone } from '../../format';
import { colors, type } from '../../theme';
import { Button, ChoiceGrid, Field, Toggle } from '../../components/ui';
import AuthLayout, { AuthLink, Notice } from './AuthLayout';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Customer sign-up. After it succeeds the customer is sent to the login page. */
export default function SignUpScreen({ onDone, onLogin }) {
  const { signUp, publicApi } = useApp();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '', branchId: null });
  const [branches, setBranches] = useState(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let alive = true;
    publicApi.get('/api/branches/public')
      .then((list) => { if (alive) setBranches(list); })
      .catch((e) => { if (alive) { setBranches([]); setError(e.message); } });
    return () => { alive = false; };
  }, [publicApi]);

  const problem = () => {
    if (form.name.trim().length < 2) return 'Enter your full name.';
    if (!EMAIL.test(form.email.trim())) return 'Enter a valid email address.';
    if (!isValidKenyanPhone(form.phone)) return 'Enter your M-Pesa number, e.g. 0712 345 678.';
    if (!form.branchId) return 'Choose your delivery area.';
    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) return 'Use a password of at least 8 characters with a letter and a number.';
    if (form.password !== form.confirm) return 'The two passwords do not match.';
    return '';
  };

  const submit = async () => {
    if (busy) return;
    const p = problem();
    if (p) { setError(p); return; }
    setBusy(true); setError('');
    try {
      const res = await signUp({ name: form.name.trim(), email: form.email.trim(), phone: form.phone, password: form.password, branchId: form.branchId });
      onDone(res.email);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Order water, request a tanker, pay by M-Pesa and track every delivery."
      footer={<AuthLink prompt="Already have an account?" action="Log in" onPress={onLogin} />}
    >
      <Field label="Full name" placeholder="e.g. Grace Wanjiku" value={form.name} onChangeText={set('name')} autoCapitalize="words" autoComplete="name" textContentType="name" />
      <Field label="Email" placeholder="you@example.com" value={form.email} onChangeText={set('email')}
        autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      <Field label="M-Pesa phone number" placeholder="0712 345 678" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
      <Text style={type.caption}>Delivery area</Text>
      {branches === null ? <ActivityIndicator color={colors.primary} /> : branches.length ? (
        <ChoiceGrid columns={2} value={form.branchId} onChange={set('branchId')}
          options={branches.map((b) => ({ value: b.id, label: b.name, sub: b.area || b.code }))} />
      ) : <Text style={type.bodySm}>No delivery areas are open yet. Please check back soon.</Text>}
      <Field label="Password" placeholder="At least 8 characters, a letter and a number" value={form.password} onChangeText={set('password')}
        secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" />
      <Field label="Confirm password" placeholder="Type it again" value={form.confirm} onChangeText={set('confirm')}
        secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" onSubmitEditing={submit} />
      <Toggle label="Show passwords" value={show} onChange={setShow} />
      {error ? <Notice>{error}</Notice> : null}
      <Button title="Create account" icon="person-add-outline" onPress={submit} loading={busy} disabled={!branches?.length} />
    </AuthLayout>
  );
}
