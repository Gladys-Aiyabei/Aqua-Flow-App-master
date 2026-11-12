import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, type } from '../theme';
import { mapsUrl } from '../format';
import { Button } from './ui';

/** "Use my current location": pins the exact delivery spot so the rider can navigate there with Google Maps. */
export default function LocationPicker({ value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const locate = async () => {
    setBusy(true); setError('');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setError('Location permission was not given. You can still type your address above.');
      } else {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        onChange({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
          accuracy: pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null,
        });
      }
    } catch {
      setError("Couldn't get your location. Check that location is switched on, or type your address above.");
    }
    setBusy(false);
  };

  if (value) {
    return (
      <View style={styles.pinned}>
        <Ionicons name="location" size={20} color={colors.mintDeep} />
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: colors.mintDeep }]}>Location pinned</Text>
          <Text style={type.bodySm}>{value.accuracy ? `Accurate to about ${value.accuracy} m · ` : ''}the rider gets Google Maps directions</Text>
        </View>
        <Button small variant="ghost" title="Map" icon="map-outline" onPress={() => Linking.openURL(mapsUrl(value))} />
        <Button small variant="ghost" title="Remove" onPress={() => onChange(null)} />
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <Button title="Use my current location" icon="navigate-outline" variant="outline" onPress={locate} loading={busy} />
      <Text style={type.bodySm}>Optional, but it helps the rider find you with Google Maps.</Text>
      {error ? <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pinned: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.mintSoft },
});
