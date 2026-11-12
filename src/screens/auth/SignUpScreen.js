import { useState } from 'react';
import { useApp } from '../../AppContext';
import { isValidKenyanPhone } from '../../format';
import { Button, Field, Toggle } from '../../components/ui';
import AuthLayout, { AuthLink, Notice } from './AuthLayout';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Customer sign-up. After it succeeds the customer is sent to the login page. */
export default function SignUpScreen({ onDone, onLogin }) {
  const { signUp } = useApp();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const problem = () => {
    if (form.name.trim().length < 2) return 'Enter your full name.';
    if (!EMAIL.test(form.email.trim())) return 'Enter a valid email address.';
    if (!isValidKenyanPhone(form.phone)) return 'Enter your M-Pesa number, e.g. 0712 345 678.';
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
      const res = await signUp({ name: form.name.trim(), email: form.email.trim(), phone: form.phone, password: form.password });
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
      <Field label="Password" placeholder="At least 8 characters, a letter and a number" value={form.password} onChangeText={set('password')}
        secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" />
      <Field label="Confirm password" placeholder="Type it again" value={form.confirm} onChangeText={set('confirm')}
        secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" onSubmitEditing={submit} />
      <Toggle label="Show passwords" value={show} onChange={setShow} />
      {error ? <Notice>{error}</Notice> : null}
      <Button title="Create account" icon="person-add-outline" onPress={submit} loading={busy} />
    </AuthLayout>
  );
}
