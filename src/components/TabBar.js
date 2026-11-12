import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

/** Bottom tabs. With more than 6 tabs (admin) the bar scrolls sideways instead of squeezing. */
export default function TabBar({ tabs, active, onChange }) {
  const insets = useSafeAreaInsets();
  const scroll = tabs.length > 6;
  const items = tabs.map((t) => {
    const on = t.key === active;
    return (
      <Pressable key={t.key} onPress={() => onChange(t.key)} style={scroll ? styles.tabFixed : styles.tab}
        accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.badge ? `${t.label}, ${t.badge} new` : t.label}>
        <View style={[styles.indicator, on && { backgroundColor: colors.primary }]} />
        <View>
          <Ionicons name={on ? t.icon : `${t.icon}-outline`} size={23} color={on ? colors.primary : colors.textFaint} />
          {t.badge ? <View style={styles.badge}><Text style={styles.badgeText}>{t.badge > 9 ? '9+' : t.badge}</Text></View> : null}
        </View>
        <Text style={[styles.label, on && { color: colors.primary }]} numberOfLines={1}>{t.label}</Text>
      </Pressable>
    );
  });
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]} accessibilityRole="tablist">
      {scroll ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-around' }}>
          {items}
        </ScrollView>
      ) : items}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingTop: 0 },
  tabFixed: { width: 76, flexGrow: 0, flexShrink: 0, alignItems: 'center', gap: 3 },
  indicator: { width: 28, height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, marginBottom: 6, backgroundColor: 'transparent' },
  label: { fontSize: 11, fontWeight: '600', color: colors.textFaint },
  badge: { position: 'absolute', top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
