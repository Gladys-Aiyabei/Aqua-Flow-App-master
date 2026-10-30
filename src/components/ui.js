import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppContext';
import { colors, radius, shadow, shadowStrong, space, type } from '../theme';
import { initials, statusOf } from '../format';

/** Scrollable screen body with pull-to-refresh wired to the live data. */
export function Screen({ children, footerSpace = 24 }) {
  const { refresh } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => { setRefreshing(true); await refresh(); setRefreshing(false); };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{ padding: space.md, paddingBottom: footerSpace, gap: space.md }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
    >
      {children}
    </ScrollView>
  );
}

export function AppHeader({ alerts = 0, onAvatarPress }) {
  const { data, session, online } = useApp();
  const insets = useSafeAreaInsets();
  const statusText = !online ? 'Offline · showing saved data' : alerts ? `${alerts} alert${alerts > 1 ? 's need' : ' needs'} attention` : 'All systems normal';
  const statusColor = !online ? colors.textFaint : alerts ? colors.danger : colors.mint;
  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <View style={styles.logo}><Ionicons name="water" size={22} color={colors.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={type.title} numberOfLines={1}>{data?.settings?.companyName ?? 'AquaFlow'}</Text>
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <Text style={type.bodySm} numberOfLines={1}>{statusText}</Text>
        </View>
      </View>
      <Pressable onPress={onAvatarPress} style={styles.row} hitSlop={8} accessibilityLabel="Account and settings">
        <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
          <Text style={[type.label, { fontSize: 13 }]} numberOfLines={1}>{data?.settings?.hubName ?? ''}</Text>
          <Text style={{ fontSize: 11, color: colors.primary }}>Till {data?.settings?.tillNumber ?? '—'}</Text>
        </View>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(session?.name)}</Text></View>
      </Pressable>
    </View>
  );
}

export function Card({ children, style, accent, onPress }) {
  const Comp = onPress ? Pressable : View;
  return (
    <Comp onPress={onPress} style={[styles.card, accent && { borderLeftWidth: 4, borderLeftColor: accent }, style]}>
      {children}
    </Comp>
  );
}

/** Deep-ocean gradient-ish hero panel used at the top of each screen. */
export function Hero({ children, style }) {
  return (
    <View style={[styles.hero, style]}>
      <View style={styles.heroBubbleA} />
      <View style={styles.heroBubbleB} />
      {children}
    </View>
  );
}

export function HeroStat({ label, value, icon }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatLabel}>{label}</Text>
      <View style={styles.row}>
        {icon ? <Ionicons name={icon} size={16} color={colors.cyanSoft} style={{ marginRight: 4 }} /> : null}
        <Text style={styles.heroStatValue}>{value}</Text>
      </View>
    </View>
  );
}

const BUTTON_VARIANTS = {
  primary: { bg: colors.primaryDeep, fg: colors.onPrimary },
  mpesa: { bg: colors.mint, fg: colors.onPrimary },
  ghost: { bg: colors.surfaceLow, fg: colors.primaryDeep },
  outline: { bg: colors.surface, fg: colors.primary, border: colors.cyan },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
};

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, small, style }) {
  const v = BUTTON_VARIANTS[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button, small && styles.buttonSmall,
        { backgroundColor: v.bg, borderColor: v.border ?? v.bg, opacity: off ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} size="small" /> : (
        <>
          {icon ? <Ionicons name={icon} size={small ? 16 : 18} color={v.fg} /> : null}
          <Text style={[styles.buttonText, small && { fontSize: 13 }, { color: v.fg }]} numberOfLines={1}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, color = colors.primaryDeep, bg = colors.surfaceLow, label }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} style={({ pressed }) => [styles.iconButton, { backgroundColor: bg, opacity: pressed ? 0.7 : 1 }]}>
      <Ionicons name={icon} size={20} color={color} />
    </Pressable>
  );
}

export function Badge({ status, label, color, bg, icon }) {
  const s = status ? statusOf(status) : {};
  const fg = color ?? s.color ?? colors.primary;
  return (
    <View style={[styles.badge, { backgroundColor: bg ?? s.bg ?? colors.surfaceMid }]}>
      {icon ? <Ionicons name={icon} size={12} color={fg} /> : <View style={[styles.dot, { backgroundColor: fg, marginRight: 0 }]} />}
      <Text style={[styles.badgeText, { color: fg }]}>{label ?? s.label}</Text>
    </View>
  );
}

export function ProgressBar({ value, color = colors.cyan, track = colors.surfaceMid, height = 8 }) {
  const w = Math.max(0, Math.min(100, value));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: track, overflow: 'hidden' }}>
      <View style={{ width: `${w}%`, height: '100%', borderRadius: height, backgroundColor: color }} />
    </View>
  );
}

export function SectionHeader({ title, subtitle, icon, action, onAction }) {
  return (
    <View style={[styles.row, { marginTop: space.sm }]}>
      {icon ? <View style={styles.sectionIcon}><Ionicons name={icon} size={18} color={colors.primary} /></View> : null}
      <View style={{ flex: 1 }}>
        <Text style={type.headline}>{title}</Text>
        {subtitle ? <Text style={type.bodySm}>{subtitle}</Text> : null}
      </View>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8} style={styles.row}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>{action}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Pill tabs, e.g. All (18) · New (4) · Delivered (5) */
export function Segmented({ options, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segmented}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.segment, active && styles.segmentActive]}>
            <Text style={[styles.segmentText, active && { color: colors.primaryDeep }]}>
              {o.label}{o.count !== undefined ? ` (${o.count})` : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Selectable tiles, e.g. tank capacity tiers or trucks to assign. */
export function ChoiceGrid({ options, value, onChange, columns = 3 }) {
  return (
    <View style={styles.choiceGrid}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => !o.disabled && onChange(o.value)}
            style={[styles.choice, { flexBasis: `${100 / columns - 3}%` }, active && styles.choiceActive, o.disabled && { opacity: 0.4 }]}
          >
            <Text style={[styles.choiceTitle, active && { color: colors.onPrimary }]} numberOfLines={1}>{o.label}</Text>
            {o.sub ? <Text style={[styles.choiceSub, active && { color: colors.primarySoft }]} numberOfLines={1}>{o.sub}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ label, prefix, style, inputStyle, multiline, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text style={type.caption}>{label}</Text> : null}
      <View style={[styles.input, multiline && { height: 96, alignItems: 'flex-start', paddingTop: 10 }, focused && styles.inputFocused]}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          placeholderTextColor={colors.textFaint}
          style={[styles.inputText, multiline && { textAlignVertical: 'top', height: '100%' }, inputStyle]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          multiline={multiline}
          {...props}
        />
      </View>
    </View>
  );
}

export function Stepper({ value, onChange, min = 0, max = 999 }) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => onChange(Math.max(min, value - 1))} style={styles.stepBtn} hitSlop={6}>
        <Ionicons name="remove" size={18} color={colors.primaryDeep} />
      </Pressable>
      <Text style={[type.title, type.num, { minWidth: 28, textAlign: 'center' }]}>{value}</Text>
      <Pressable onPress={() => onChange(Math.min(max, value + 1))} style={[styles.stepBtn, { backgroundColor: colors.primaryDeep }]} hitSlop={6}>
        <Ionicons name="add" size={18} color={colors.onPrimary} />
      </Pressable>
    </View>
  );
}

export function Stars({ value, size = 16, onChange }) {
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} disabled={!onChange} onPress={() => onChange?.(n)} hitSlop={4}>
          <Ionicons name={n <= value ? 'star' : 'star-outline'} size={size} color={colors.star} style={{ marginRight: 2 }} />
        </Pressable>
      ))}
    </View>
  );
}

export function Empty({ icon = 'water-outline', title, text }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: space.xl }}>
      <View style={[styles.sectionIcon, { width: 52, height: 52, borderRadius: 26 }]}><Ionicons name={icon} size={26} color={colors.primary} /></View>
      <Text style={[type.title, { marginTop: space.sm }]}>{title}</Text>
      {text ? <Text style={[type.bodySm, { textAlign: 'center', marginTop: 4 }]}>{text}</Text> : null}
    </Card>
  );
}

export function InfoRow({ icon, children, color = colors.textMuted }) {
  return (
    <View style={[styles.row, { gap: 6 }]}>
      <Ionicons name={icon} size={15} color={color} />
      <Text style={[type.bodySm, { flex: 1, color }]} numberOfLines={2}>{children}</Text>
    </View>
  );
}

/** Bottom sheet used for every form in the app. */
export function Sheet({ visible, onClose, title, subtitle, children, footer }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
          <View style={styles.grabber} />
          <View style={[styles.row, { marginBottom: space.sm }]}>
            <View style={{ flex: 1 }}>
              <Text style={type.headline}>{title}</Text>
              {subtitle ? <Text style={type.bodySm}>{subtitle}</Text> : null}
            </View>
            <IconButton icon="close" onPress={onClose} label="Close" />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.md, paddingBottom: space.sm }}>
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingTop: space.sm }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Toggle({ label, value, onChange }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={[styles.row, { gap: 10 }]}>
      <Ionicons name={value ? 'checkbox' : 'square-outline'} size={22} color={value ? colors.primary : colors.textFaint} />
      <Text style={type.body}>{label}</Text>
    </Pressable>
  );
}

export const ui = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inset: { backgroundColor: colors.surfaceLow, borderRadius: radius.md, padding: 12, gap: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.md, paddingBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.96)', borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  logo: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surfaceLow, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.cyanSoft },
  avatarText: { color: colors.onPrimary, fontWeight: '700' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.md, gap: 10,
    borderWidth: 1, borderColor: 'rgba(0, 180, 216, 0.18)', ...shadow,
  },
  hero: { backgroundColor: colors.primaryDeep, borderRadius: radius.xl, padding: 20, gap: 12, overflow: 'hidden', ...shadowStrong },
  heroBubbleA: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: colors.primary, right: -60, top: -80, opacity: 0.8 },
  heroBubbleB: { position: 'absolute', width: 140, height: 140, borderRadius: 70, backgroundColor: colors.cyan, right: 30, bottom: -90, opacity: 0.35 },
  heroStat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.md, padding: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  heroStatLabel: { color: colors.cyanSoft, fontSize: 12, marginBottom: 2 },
  heroStatValue: { color: colors.onPrimary, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  button: {
    minHeight: 48, borderRadius: radius.md, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, borderWidth: 1,
  },
  buttonSmall: { minHeight: 40, paddingHorizontal: 12 },
  buttonText: { fontSize: 15, fontWeight: '700' },
  iconButton: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.full, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  sectionIcon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.surfaceLow, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  segmented: { backgroundColor: colors.surfaceMid, borderRadius: radius.md, padding: 4, gap: 4 },
  segment: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.surface, ...shadow },
  segmentText: { fontWeight: '600', color: colors.textMuted, fontSize: 13 },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { flexGrow: 1, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center' },
  choiceActive: { backgroundColor: colors.primaryDeep, borderColor: colors.primaryDeep },
  choiceTitle: { fontWeight: '700', color: colors.text, fontSize: 15 },
  choiceSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  input: {
    minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12,
  },
  inputFocused: { borderColor: colors.primary, ...Platform.select({ web: { boxShadow: '0 0 0 3px rgba(0,180,216,0.2)' }, default: {} }) },
  inputText: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 10, ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }) },
  prefix: { color: colors.primary, fontWeight: '700', marginRight: 8, fontSize: 15 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.surfaceMid, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 31, 44, 0.45)' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.md,
    maxHeight: '90%', borderTopWidth: 1, borderColor: 'rgba(0, 180, 216, 0.4)',
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.surfaceHigh, marginBottom: 10 },
});
