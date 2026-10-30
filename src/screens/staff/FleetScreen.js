import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { confirm, useApp } from '../../AppContext';
import { colors, radius, type } from '../../theme';
import { compactLitres, formatNumber, isToday, kes, litres, localPhone, statusOf, timeAgo } from '../../format';
import {
  Badge, Button, Card, ChoiceGrid, Empty, Field, Hero, HeroStat, IconButton, InfoRow, Screen, SectionHeader, Segmented, Sheet, ui,
} from '../../components/ui';
import PaymentSheet from '../../components/PaymentSheet';

const ACTIVE = ['scheduled', 'filling', 'en_route', 'discharging'];
const NEXT_STEP = {
  scheduled: { status: 'filling', label: 'Start filling', icon: 'water' },
  filling: { status: 'en_route', label: 'Dispatch tanker', icon: 'navigate' },
  en_route: { status: 'discharging', label: 'Arrived · discharge', icon: 'git-merge' },
  discharging: { status: 'delivered', label: 'Mark delivered', icon: 'checkmark-done' },
};
const STEPS = ['scheduled', 'filling', 'en_route', 'discharging', 'delivered'];
const ACCENT = { requested: colors.amber, scheduled: colors.primary, filling: colors.cyan, en_route: colors.mint, discharging: colors.cyan, delivered: colors.mintDeep, cancelled: colors.danger };

const call = (phone) => phone && Linking.openURL(`tel:+${String(phone).replace(/^\+/, '')}`);

export default function FleetScreen() {
  const { data, act } = useApp();
  const [tab, setTab] = useState('missions');
  const [filter, setFilter] = useState('active');
  const [mission, setMission] = useState(null); // {} new | delivery to assign
  const [truckForm, setTruckForm] = useState(null);
  const [paying, setPaying] = useState(null);

  const trucks = data?.trucks ?? [];
  const deliveries = data?.deliveries ?? [];
  const truckById = Object.fromEntries(trucks.map((t) => [t.id, t]));

  const dispatchedToday = deliveries.filter((d) => ['en_route', 'discharging', 'delivered'].includes(d.status) && isToday(d.updatedAt)).reduce((s, d) => s + d.volumeL, 0);
  const count = (st) => trucks.filter((t) => t.status === st).length;
  const groups = {
    active: deliveries.filter((d) => ACTIVE.includes(d.status)),
    requested: deliveries.filter((d) => d.status === 'requested'),
    done: deliveries.filter((d) => ['delivered', 'cancelled'].includes(d.status)),
  };

  const advance = (d, status) => act((api) => api.patch(`/api/deliveries/${d.id}`, { status }));
  const cancel = async (d) => {
    if (await confirm('Cancel mission?', `${d.id} for ${d.customerName} will be cancelled.`, 'Cancel mission')) advance(d, 'cancelled');
  };

  return (
    <Screen>
      <Hero>
        <View style={ui.between}>
          <Badge label="Active fleet grid" color={colors.onPrimary} bg="rgba(255,255,255,0.18)" />
          <Text style={{ color: colors.cyanSoft, fontWeight: '600' }}>{data?.settings?.hubName}</Text>
        </View>
        <Text style={styles.caption}>TODAY’S DISPATCHED BULK WATER</Text>
        <Text style={styles.value}>{formatNumber(dispatchedToday)} <Text style={styles.unit}>Litres</Text></Text>
        <View style={[ui.row, { gap: 8 }]}>
          <HeroStat label="En route" icon="navigate" value={count('en_route') + count('discharging')} />
          <HeroStat label="Filling" icon="water" value={count('filling')} />
          <HeroStat label="Standby" icon="pause" value={count('idle')} />
        </View>
      </Hero>

      <Segmented value={tab} onChange={setTab} options={[{ value: 'missions', label: 'Bulk missions', count: deliveries.length }, { value: 'trucks', label: 'Tankers', count: trucks.length }]} />

      {tab === 'missions' ? (
        <>
          <Button title="Dispatch new mission" icon="add-circle" onPress={() => setMission({})} />
          <Segmented value={filter} onChange={setFilter} options={[
            { value: 'active', label: 'Active', count: groups.active.length },
            { value: 'requested', label: 'Requests', count: groups.requested.length },
            { value: 'done', label: 'Completed', count: groups.done.length },
          ]} />
          {groups[filter].length === 0 ? <Empty icon="bus-outline" title="Nothing here" text={filter === 'requested' ? 'Customer tanker requests appear here.' : 'Dispatch a mission to get started.'} /> : null}
          {groups[filter].map((d) => {
            const truck = truckById[d.truckId];
            const next = NEXT_STEP[d.status];
            const stepIndex = STEPS.indexOf(d.status);
            return (
              <Card key={d.id} accent={ACCENT[d.status]}>
                <View style={ui.between}>
                  <View style={{ flex: 1 }}>
                    <View style={[ui.row, { gap: 8 }]}>
                      <Text style={type.title}>{d.id}</Text>
                      <Badge status={d.status} />
                    </View>
                    <Text style={type.bodySm}>{d.customerName} · {timeAgo(d.createdAt)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[type.title, type.num, { color: colors.primary }]}>{litres(d.volumeL)}</Text>
                    <Text style={[type.bodySm, type.num]}>{kes(d.amount)}</Text>
                  </View>
                </View>

                <View style={ui.inset}>
                  <InfoRow icon="location">{d.destination}</InfoRow>
                  {truck ? <InfoRow icon="bus">{truck.unit} · {truck.plate} · {truck.driverName}</InfoRow> : <InfoRow icon="alert-circle" color={colors.amber}>No tanker assigned yet</InfoRow>}
                  {d.notes ? <InfoRow icon="document-text">{d.notes}</InfoRow> : null}
                  {stepIndex >= 0 ? (
                    <View style={styles.steps}>
                      {STEPS.map((s, i) => <View key={s} style={[styles.step, i <= stepIndex && { backgroundColor: colors.primary }]} />)}
                    </View>
                  ) : null}
                </View>

                <View style={ui.between}>
                  {d.paymentStatus === 'paid'
                    ? <Badge status="paid" icon="checkmark-circle" label={`Paid · ${d.mpesaRef ?? ''}`} />
                    : <Badge status="unpaid" label="Unpaid" />}
                  <View style={[ui.row, { gap: 6 }]}>
                    {truck?.driverPhone ? <IconButton icon="call" label="Call driver" onPress={() => call(truck.driverPhone)} /> : null}
                    {d.customerPhone ? <IconButton icon="person" label="Call customer" onPress={() => call(d.customerPhone)} /> : null}
                  </View>
                </View>

                <View style={ui.actions}>
                  {d.status === 'requested' ? <Button small title="Assign tanker" icon="bus" onPress={() => setMission(d)} style={{ flex: 1 }} /> : null}
                  {next ? <Button small title={next.label} icon={next.icon} onPress={() => advance(d, next.status)} style={{ flex: 1 }} /> : null}
                  {d.paymentStatus !== 'paid' && d.status !== 'cancelled' ? <Button small title="Request pay" icon="phone-portrait" variant="mpesa" onPress={() => setPaying(d)} /> : null}
                </View>
                {['requested', 'scheduled', 'filling'].includes(d.status) ? (
                  <Button small title="Cancel mission" variant="danger" icon="close" onPress={() => cancel(d)} />
                ) : null}
              </Card>
            );
          })}
        </>
      ) : (
        <>
          <SectionHeader title="Tanker units" subtitle="Tap a status to update" icon="bus" action="Add tanker" onAction={() => setTruckForm({})} />
          {trucks.length === 0 ? <Empty icon="bus-outline" title="No tankers" text="Add your water bowsers and delivery trucks." /> : null}
          {trucks.map((t) => {
            const job = deliveries.find((d) => d.truckId === t.id && ACTIVE.includes(d.status));
            return (
              <Card key={t.id} accent={ACCENT[t.status] ?? colors.surfaceHigh}>
                <View style={ui.between}>
                  <View style={[ui.row, { gap: 10, flex: 1 }]}>
                    <View style={styles.truckIcon}><Ionicons name="bus" size={22} color={colors.primary} /></View>
                    <View style={{ flex: 1 }}>
                      <View style={[ui.row, { gap: 8 }]}>
                        <Text style={type.title}>{t.unit}</Text>
                        <Badge status={t.status} label={statusOf(t.status).label} />
                      </View>
                      <Text style={type.bodySm}>{t.plate} · Driver: {t.driverName || '—'}</Text>
                    </View>
                  </View>
                  <Text style={[type.title, type.num, { color: colors.primary }]}>{compactLitres(t.capacityL)}</Text>
                </View>
                {job ? <View style={ui.inset}><InfoRow icon="navigate">{job.id} · {job.customerName} · {job.destination}</InfoRow></View> : null}
                <View style={ui.actions}>
                  <Button small title="Call driver" icon="call" variant="ghost" onPress={() => call(t.driverPhone)} style={{ flex: 1 }} disabled={!t.driverPhone} />
                  {!job ? (
                    <Button small title={t.status === 'maintenance' ? 'Back in service' : 'Maintenance'} icon="construct" variant="ghost" style={{ flex: 1 }}
                      onPress={() => act((api) => api.patch(`/api/trucks/${t.id}`, { status: t.status === 'maintenance' ? 'idle' : 'maintenance' }))} />
                  ) : null}
                  <IconButton icon="create-outline" label="Edit" onPress={() => setTruckForm(t)} />
                </View>
              </Card>
            );
          })}
        </>
      )}

      <MissionSheet mission={mission} onClose={() => setMission(null)} />
      <TruckSheet truck={truckForm} onClose={() => setTruckForm(null)} />
      <PaymentSheet visible={Boolean(paying)} onClose={() => setPaying(null)} title="Request M-Pesa payment"
        target={paying ? { deliveryId: paying.id, amount: paying.amount, description: `${paying.id} · ${paying.customerName}` } : null}
        defaultPhone={paying?.customerPhone} />
    </Screen>
  );
}

function MissionSheet({ mission, onClose }) {
  const { data, act } = useApp();
  const isNew = mission && !mission.id;
  const [form, setForm] = useState({});
  const [key, setKey] = useState(null);
  const k = mission ? mission.id ?? 'new' : null;
  const price = data?.settings?.bulkPricePerLitre ?? 0;
  if (k !== key) {
    setKey(k);
    setForm(mission ? {
      customerName: mission.customerName ?? '', customerPhone: mission.customerPhone ? localPhone(mission.customerPhone) : '',
      destination: mission.destination ?? '', volumeL: mission.volumeL ?? 10000, truckId: null, sourceTankId: data?.tanks?.[0]?.id ?? null, notes: mission.notes ?? '',
    } : {});
  }
  const set = (f) => (v) => setForm((s) => ({ ...s, [f]: v }));
  const trucks = data?.trucks ?? [];
  const busy = new Set((data?.deliveries ?? []).filter((d) => ACTIVE.includes(d.status)).map((d) => d.truckId));

  const submit = async () => {
    const ok = await act((api) => (isNew
      ? api.post('/api/deliveries', form)
      : api.patch(`/api/deliveries/${mission.id}`, { truckId: form.truckId, sourceTankId: form.sourceTankId })), 'Mission scheduled');
    if (ok) onClose();
  };

  return (
    <Sheet visible={Boolean(mission)} onClose={onClose} title={isNew ? 'Dispatch new mission' : `Assign ${mission?.id ?? ''}`}
      subtitle={isNew ? 'Bulk water delivery by tanker' : `${mission?.customerName ?? ''} · ${litres(mission?.volumeL)}`}
      footer={<Button title={isNew ? 'Deploy bulk mission' : 'Assign tanker'} icon="rocket" onPress={submit} disabled={!form.truckId} />}>
      {isNew ? (
        <>
          <Field label="Customer / site" placeholder="Grand Coastal Resort" value={form.customerName} onChangeText={set('customerName')} />
          <Field label="Customer phone" keyboardType="phone-pad" placeholder="0722 000 000" value={form.customerPhone} onChangeText={set('customerPhone')} />
          <Field label="Destination" placeholder="Bamburi Industrial Zone, Gate 2" value={form.destination} onChangeText={set('destination')} />
          <Text style={type.caption}>Volume</Text>
          <ChoiceGrid value={form.volumeL} onChange={set('volumeL')} options={[
            { value: 5000, label: '5 kL', sub: 'Rapid urban' }, { value: 10000, label: '10 kL', sub: 'Commercial' }, { value: 18000, label: '18 kL', sub: 'Industrial' },
          ]} />
          <Field label="Or custom volume (litres)" keyboardType="numeric" value={String(form.volumeL ?? '')} onChangeText={(v) => set('volumeL')(Number(v.replace(/\D/g, '')) || '')} />
          <Text style={type.bodySm}>Price: {kes(Number(form.volumeL || 0) * price)} at KES {price}/L</Text>
          <Field label="Notes" placeholder="Gate code, contact on site…" value={form.notes} onChangeText={set('notes')} />
        </>
      ) : null}
      <Text style={type.caption}>Tanker</Text>
      <ChoiceGrid columns={2} value={form.truckId} onChange={set('truckId')} options={trucks.map((t) => ({
        value: t.id, label: `${t.unit} · ${compactLitres(t.capacityL)}`, sub: t.status === 'maintenance' ? 'Maintenance' : busy.has(t.id) ? 'On a mission' : t.driverName,
        disabled: t.status === 'maintenance' || busy.has(t.id),
      }))} />
      <Text style={type.caption}>Fill from</Text>
      <ChoiceGrid columns={2} value={form.sourceTankId} onChange={set('sourceTankId')} options={(data?.tanks ?? []).map((t) => ({ value: t.id, label: t.name, sub: litres(t.levelL) }))} />
    </Sheet>
  );
}

function TruckSheet({ truck, onClose }) {
  const { act } = useApp();
  const isNew = truck && !truck.id;
  const [form, setForm] = useState({});
  const [key, setKey] = useState(null);
  const k = truck ? truck.id ?? 'new' : null;
  if (k !== key) {
    setKey(k);
    setForm(truck ? { unit: truck.unit ?? '', plate: truck.plate ?? '', capacityL: truck.capacityL ? String(truck.capacityL) : '', driverName: truck.driverName ?? '', driverPhone: truck.driverPhone ? localPhone(truck.driverPhone) : '' } : {});
  }
  const set = (f) => (v) => setForm((s) => ({ ...s, [f]: v }));
  const save = async () => {
    if (await act((api) => (isNew ? api.post('/api/trucks', form) : api.patch(`/api/trucks/${truck.id}`, form)))) onClose();
  };
  const remove = async () => {
    if (await confirm('Remove tanker?', `${truck.unit} (${truck.plate}) will be removed from the fleet.`, 'Remove')) {
      if (await act((api) => api.del(`/api/trucks/${truck.id}`))) onClose();
    }
  };
  return (
    <Sheet visible={Boolean(truck)} onClose={onClose} title={isNew ? 'Add tanker' : `Edit ${truck?.unit ?? ''}`}
      footer={<View style={{ gap: 8 }}>
        <Button title="Save" icon="checkmark" onPress={save} />
        {!isNew ? <Button title="Remove tanker" variant="danger" icon="trash-outline" onPress={remove} /> : null}
      </View>}>
      <View style={[ui.row, { gap: 8 }]}>
        <Field style={{ flex: 1 }} label="Unit name" placeholder="Unit 11" value={form.unit} onChangeText={set('unit')} />
        <Field style={{ flex: 1 }} label="Number plate" placeholder="KDD 123A" autoCapitalize="characters" value={form.plate} onChangeText={set('plate')} />
      </View>
      <Field label="Tank capacity (litres)" keyboardType="numeric" value={form.capacityL} onChangeText={set('capacityL')} />
      <Field label="Driver name" value={form.driverName} onChangeText={set('driverName')} />
      <Field label="Driver phone" keyboardType="phone-pad" value={form.driverPhone} onChangeText={set('driverPhone')} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  caption: { color: colors.cyanSoft, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  value: { color: colors.onPrimary, fontSize: 36, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 18, fontWeight: '600', color: colors.cyanSoft },
  steps: { flexDirection: 'row', gap: 4, marginTop: 4 },
  step: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceHigh },
  truckIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surfaceLow, alignItems: 'center', justifyContent: 'center' },
});
