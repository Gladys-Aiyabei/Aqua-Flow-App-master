import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AquaScene from '../../components/AquaScene';
import { colors, radius, space, type } from '../../theme';

/** Shared frame for the sign-up, login and password pages: aqua scene + frosted card. */
export default function AuthLayout({ title, subtitle, children, footer }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: '#012A4A' }}>
      <AquaScene />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 96, paddingBottom: insets.bottom + 140, paddingHorizontal: space.md }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.content}>
            <View style={styles.brand}>
              <Text style={styles.wordmark}>AquaFlow</Text>
              <Text style={styles.tagline}>Clean water, tracked from source to tap</Text>
            </View>
            <View style={styles.card}>
              <View style={{ gap: 4 }}>
                <Text style={type.headline}>{title}</Text>
                {subtitle ? <Text style={type.bodySm}>{subtitle}</Text> : null}
              </View>
              {children}
            </View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

export function AuthLink({ prompt, action, onPress }) {
  return (
    <Pressable onPress={onPress} style={styles.link} accessibilityRole="link">
      <Text style={styles.linkText}>{prompt} <Text style={styles.linkAction}>{action}</Text></Text>
    </Pressable>
  );
}

export function Notice({ tone = 'error', children }) {
  const error = tone === 'error';
  return (
    <View style={[styles.notice, { backgroundColor: error ? colors.dangerSoft : colors.mintSoft }]} accessibilityLiveRegion="polite">
      <Ionicons name={error ? 'alert-circle' : 'checkmark-circle'} size={18} color={error ? colors.danger : colors.mintDeep} />
      <Text style={{ color: error ? colors.danger : colors.mintDeep, flex: 1 }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 440, alignSelf: 'center', gap: space.md },
  brand: { alignItems: 'center', gap: 4, marginBottom: space.sm },
  wordmark: { color: colors.onPrimary, fontSize: 34, fontWeight: '800', letterSpacing: -1 },
  tagline: { color: '#CAF0F8', fontSize: 15 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: radius.xl, padding: 20, gap: space.md,
    borderWidth: 1, borderColor: 'rgba(202,240,248,0.8)',
    ...Platform.select({
      web: { boxShadow: '0px 18px 40px -12px rgba(1,42,74,0.55)', backdropFilter: 'blur(10px)' },
      default: { shadowColor: '#012A4A', shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
    }),
  },
  footer: { alignItems: 'center' },
  link: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.full, backgroundColor: 'rgba(1,42,74,0.55)' },
  linkText: { color: '#E0FBFF', fontSize: 14 },
  linkAction: { color: '#FFFFFF', fontWeight: '700' },
  notice: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: radius.md, alignItems: 'flex-start' },
});
