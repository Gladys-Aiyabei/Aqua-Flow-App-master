import { createElement } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { mapsUrl } from '../format';

/** Google's embeddable map for a pin or an address (no API key needed). */
export function embedUrl({ latitude, longitude, address }) {
  if (latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined) {
    return `https://maps.google.com/maps?q=${Number(latitude)},${Number(longitude)}&z=16&output=embed`;
  }
  const a = String(address || '').trim();
  if (!a || a === 'Pinned location' || a === 'Counter pickup') return null;
  return `https://maps.google.com/maps?q=${encodeURIComponent(`${a}, Kenya`)}&z=15&output=embed`;
}

/**
 * A live Google map showing where the water goes, with a button for turn-by-turn directions.
 * Shows nothing if there is neither a pin nor an address.
 */
export default function MapEmbed({ latitude, longitude, address, height = 180, title = 'Delivery location' }) {
  const src = embedUrl({ latitude, longitude, address });
  if (!src) return null;
  const directions = mapsUrl({ latitude, longitude, address });
  const pinned = latitude !== null && latitude !== undefined;
  return (
    <View style={styles.wrap} accessibilityLabel={`${title} map`}>
      <View style={{ height }}>
        {Platform.OS === 'web'
          ? createElement('iframe', {
            src, title, loading: 'lazy', referrerPolicy: 'no-referrer-when-downgrade',
            style: { border: 0, width: '100%', height: '100%', display: 'block' },
          })
          : <WebView source={{ uri: src }} style={{ flex: 1 }} scrollEnabled={false} originWhitelist={['https://*']} />}
      </View>
      <Pressable style={styles.bar} onPress={() => directions && Linking.openURL(directions)} accessibilityRole="link">
        <Ionicons name={pinned ? 'location' : 'location-outline'} size={16} color={colors.primary} />
        <Text style={styles.barText} numberOfLines={1}>{pinned ? 'Pinned location' : address}</Text>
        <Text style={styles.open}>Open in Google Maps</Text>
        <Ionicons name="open-outline" size={14} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceLow },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.surface },
  barText: { flex: 1, fontSize: 13, color: colors.textMuted },
  open: { fontSize: 13, fontWeight: '700', color: colors.primary },
});
