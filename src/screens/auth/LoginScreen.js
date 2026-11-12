import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { useApp } from '../../AppContext';
import { isDevBuild } from '../../api';
import { colors } from '../../theme';
import { Button, Field, Toggle } from '../../components/ui';
import AuthLayout, { AuthLink, Notice } from './AuthLayout';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** One login page for everyone: customers, staff and the admin. The server decides what each can see. */
export default function LoginScreen({ initialEmail = '', notice, onSignUp }) {
  const { signIn, apiUrl } = useApp();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState(apiUrl);
  const [showServer, setShowServer] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!EMAIL.test(email.trim())) { setError('Enter the email address you signed up with.'); return; }
    if (!password) { setError('Enter your password.'); return; }
    setBusy(true); setError('');
    try {
      await signIn(email.trim(), password, url);
    } catch (e) {
      setError(e.message);
      setPassword('');
    }
    setBusy(false);
  };

  return (
    <AuthLayout
      title="Log in"
      subtitle="Welcome back. Use the email and password for your AquaFlow account."
      footer={<AuthLink prompt="New to AquaFlow?" action="Create an account" onPress={onSignUp} />}
    >
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <Field label="Email" placeholder="you@example.com" value={email} onChangeText={setEmail}
        autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      <Field label="Password" placeholder="Your password" value={password} onChangeText={setPassword}
        secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password"
        onSubmitEditing={submit} />
      <Toggle label="Show password" value={show} onChange={setShow} />
      {error ? <Notice>{error}</Notice> : null}
      <Button title="Log in" icon="log-in-outline" onPress={submit} loading={busy} />
      <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center' }}>
        Staff: use the email and temporary password from your admin.
      </Text>
      {isDevBuild ? (
        <>
          <Pressable onPress={() => setShowServer((s) => !s)} style={{ alignSelf: 'center' }}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>{showServer ? 'Hide server address' : 'Server address (development)'}</Text>
          </Pressable>
          {showServer ? <Field label="AquaFlow server" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" /> : null}
        </>
      ) : null}
    </AuthLayout>
  );
}
