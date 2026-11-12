import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppContext';
import { colors, radius, type } from '../theme';
import { Button, Card, ChoiceGrid, Sheet } from './ui';

/** The customer's delivery area (branch) and whether one is chosen yet. */
export function useDeliveryArea() {
  const { data, session } = useApp();
  const areas = data?.branches ?? [];
  const area = areas.find((b) => b.id === session?.branchId) ?? null;
  return { area, areas, hasArea: Boolean(area) };
}

/**
 * Shown on the customer's dashboard. With no area yet, the choices are right on the card;
 * afterwards it shows where we deliver, with a button to change it.
 */
export default function DeliveryAreaCard() {
  const { act } = useApp();
  const { area, areas } = useDeliveryArea();
  const [changing, setChanging] = useState(false);
  const [choice, setChoice] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async (branchId) => {
    if (!branchId || branchId === area?.id) { setChanging(false); return; }
    setSaving(true);
    const ok = await act((api) => api.patch('/api/me', { branchId }));
    setSaving(false);
    if (ok) setChanging(false);
  };

  const options = areas.map((b) => ({ value: b.id, label: b.name, sub: b.area || b.code }));

  if (!area) {
    return (
      <Card accent={colors.amber}>
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: colors.amberSoft }]}><Ionicons name="location" size={20} color={colors.amber} /></View>
          <View style={{ flex: 1 }}>
            <Text style={type.title}>Where should we deliver?</Text>
            <Text style={type.bodySm}>Choose your area so the right team brings your water.</Text>
          </View>
        </View>
        {options.length ? (
          <ChoiceGrid columns={2} value={null} onChange={save} options={options} />
        ) : <Text style={type.bodySm}>We are not delivering in any area yet. Please check back soon.</Text>}
        {saving ? <Text style={[type.bodySm, { textAlign: 'center' }]}>Saving…</Text> : null}
      </Card>
    );
  }

  return (
    <>
      <Card>
        <View style={styles.row}>
          <View style={styles.icon}><Ionicons name="location" size={20} color={colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={type.caption}>Delivering to</Text>
            <Text style={type.title}>{area.name}</Text>
            {area.area ? <Text style={type.bodySm} numberOfLines={1}>{area.area}</Text> : null}
          </View>
          <Button small variant="ghost" title="Change" icon="swap-horizontal" onPress={() => { setChoice(area.id); setChanging(true); }} />
        </View>
      </Card>
      <Sheet visible={changing} onClose={() => setChanging(false)} title="Change delivery area"
        subtitle="New orders and tanker requests will go to the team in this area"
        footer={<Button title="Save area" icon="checkmark" onPress={() => save(choice)} loading={saving} />}>
        <ChoiceGrid columns={2} value={choice} onChange={setChoice} options={options} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surfaceLow, alignItems: 'center', justifyContent: 'center' },
});
