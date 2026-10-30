import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppContext';
import { colors, radius, space, type } from '../theme';
import { Button, Card, Field, Segmented } from '../components/ui';

export default function LoginScreen() {
  const { apiUrl, signIn } = useApp();
  const insets = useSafeAreaInsets();
  const [role, setRole] = useState('customer');
  const [url, setUrl] = useState(apiUrl);
  const [showServer, setShowServer] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await signIn(url, role, role === 'staff' ? { pin, name: name || undefined } : { name, phone });
    } catch (e) {
      setError(e.message);
      if (e.status === 0) setShowServer(true);
    }
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.primaryDeep }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg }} keyboardShouldPersistTaps="handled">
        <View style={styles.bubbleA} />
        <View style={styles.bubbleB} />
        <View style={styles.content}>
          <View style={styles.brand}>
            <View style={styles.logo}><Ionicons name="water" size={40} color={colors.primary} /></View>
            <Text style={styles.title}>AquaFlow</Text>
            <Text style={styles.tagline}>Clean water, tracked from source to tap</Text>
          </View>

          <Card style={styles.panel}>
          <Segmented
            value={role}
            onChange={(r) => { setRole(r); setError(''); }}
            options={[{ value: 'customer', label: 'I am a customer' }, { value: 'staff', label: 'Company staff' }]}
          />

          {role === 'customer' ? (
            <>
              <Text style={type.bodySm}>Order bottled water, request a tanker, pay by M-Pesa and track deliveries.</Text>
              <Field label="Your name" placeholder="e.g. Grace Wanjiku" value={name} onChangeText={setName} autoCapitalize="words" />
              <Field label="M-Pesa phone number" placeholder="0712 345 678" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
            </>
          ) : (
            <>
              <Text style={type.bodySm}>Manage tanks, fleet, store, orders, payments and feedback.</Text>
              <Field label="Your name" placeholder="Operations Manager" value={name} onChangeText={setName} autoCapitalize="words" />
              <Field label="Staff PIN" placeholder="••••" keyboardType="number-pad" secureTextEntry value={pin} onChangeText={setPin} onSubmitEditing={submit} />
            </>
          )}

          {error ? <View style={styles.error}><Ionicons name="alert-circle" size={18} color={colors.danger} /><Text style={{ color: colors.danger, flex: 1 }}>{error}</Text></View> : null}

          <Button title={role === 'staff' ? 'Open operations console' : 'Continue'} icon="arrow-forward" onPress={submit} loading={busy} />

          <Pressable onPress={() => setShowServer((s) => !s)} style={{ alignSelf: 'center' }}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>{showServer ? 'Hide server settings' : 'Server settings'}</Text>
          </Pressable>
          {showServer ? (
            <Field label="AquaFlow server address" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://192.168.1.20:4000" />
          ) : null}
          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bubbleA: { position: 'absolute', width: 320, height: 320, borderRadius: 160, backgroundColor: colors.primary, top: -120, right: -120 },
  bubbleB: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: colors.cyan, opacity: 0.25, top: 180, left: -100 },
  content: { display: 'flex', flex: 1, width: '100%', maxWidth: 480, paddingHorizontal: space.md, alignSelf: 'center', justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: space.lg, gap: 6 },
  logo: { width: 76, height: 76, borderRadius: radius.xl, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  title: { color: colors.onPrimary, fontSize: 32, fontWeight: '800', letterSpacing: -1 },
  tagline: { color: colors.cyanSoft, fontSize: 15 },
  panel: { width: '100%', padding: 20, gap: space.md, borderRadius: radius.xl },
  error: { flexDirection: 'row', gap: 8, backgroundColor: colors.dangerSoft, padding: 10, borderRadius: radius.md },
});
