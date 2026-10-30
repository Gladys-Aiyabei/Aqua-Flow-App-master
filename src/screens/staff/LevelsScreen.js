import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { confirm, useApp } from '../../AppContext';
import { colors, radius, type } from '../../theme';
import { compactLitres, formatNumber, levelState, litres, pct, timeAgo } from '../../format';
import { Badge, Button, Card, Empty, Field, Hero, HeroStat, ProgressBar, Screen, SectionHeader, Sheet, ui } from '../../components/ui';

export default function LevelsScreen() {
  const { data, act, lastSync, online } = useApp();
  const [editing, setEditing] = useState(null); // tank being edited, or {} for new
  const tanks = data?.tanks ?? [];
  const low = data?.settings?.lowLevelPercent ?? 20;
  const checkedAt = lastSync?.getTime() ?? 0;
  const gaugeIsLive = (tank) => {
    const age = checkedAt - Date.parse(tank.updatedAt || '');
    return online && Number.isFinite(age) && age >= 0 && age <= 60_000;
  };
  const liveGaugeCount = tanks.filter(gaugeIsLive).length;
  const telemetryLabel = !tanks.length ? 'No tanks' : liveGaugeCount === tanks.length ? 'Gauges live' : `${liveGaugeCount}/${tanks.length} gauges live`;

  const stored = tanks.reduce((s, t) => s + t.levelL, 0);
  const capacity = tanks.reduce((s, t) => s + t.capacityL, 0);
  const inflow = tanks.reduce((s, t) => s + (t.inflowLph || 0), 0);
  const outflow = tanks.reduce((s, t) => s + (t.outflowLph || 0), 0);
  const critical = tanks.filter((t) => pct(t.levelL, t.capacityL) < low);

  const feed = tanks
    .flatMap((t) => (t.history ?? []).slice(-6).map((h, i, arr) => ({ ...h, tank: t, delta: i ? h.levelL - arr[i - 1].levelL : 0 })))
    .sort((a, b) => Date.parse(b.t) - Date.parse(a.t))
    .slice(0, 6);

  return (
    <Screen>
      <Hero>
        <View style={ui.between}>
          <Text style={styles.heroCaption}>TOTAL STORED WATER</Text>
          <Badge label={telemetryLabel} color={liveGaugeCount === tanks.length && tanks.length ? colors.onPrimary : colors.amber} bg={liveGaugeCount === tanks.length && tanks.length ? 'rgba(0,168,107,0.55)' : colors.amberSoft} />
        </View>
        <Text style={styles.heroValue}>{formatNumber(stored)} <Text style={styles.heroUnit}>Litres</Text></Text>
        <ProgressBar value={pct(stored, capacity)} color={colors.cyan} track="rgba(255,255,255,0.2)" />
        <Text style={{ color: colors.cyanSoft, fontWeight: '600' }}>{pct(stored, capacity)}% of {compactLitres(capacity)} capacity · {tanks.length} tanks</Text>
        <View style={[ui.row, { gap: 8 }]}>
          <HeroStat label="Net inflow" icon="arrow-down" value={`${formatNumber(inflow)} L/h`} />
          <HeroStat label="Outflow" icon="arrow-up" value={`${formatNumber(outflow)} L/h`} />
        </View>
      </Hero>

      {critical.map((t) => (
        <Card key={t.id} accent={colors.danger} style={{ backgroundColor: '#FFF6F5' }}>
          <View style={[ui.row, { gap: 10 }]}>
            <Ionicons name="warning" size={22} color={colors.danger} />
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: colors.danger }]}>{t.name} is at {pct(t.levelL, t.capacityL)}%</Text>
              <Text style={type.bodySm}>Below the {low}% safety reserve. Schedule a refill or reroute supply.</Text>
            </View>
          </View>
        </Card>
      ))}

      <SectionHeader title="Reservoirs & Tanks" subtitle={`${tanks.length} monitored units`} icon="water" action="Add tank" onAction={() => setEditing({})} />

      {tanks.length === 0 ? <Empty title="No tanks yet" text="Add your reservoirs, boreholes and storage tanks to start tracking levels." /> : null}

      {tanks.map((t) => {
        const st = levelState(t.levelL, t.capacityL, low);
        const history = (t.history ?? []).slice(-24);
        const max = Math.max(t.capacityL, 1);
        return (
          <Card key={t.id} accent={st.label === 'Critical' ? colors.danger : undefined}>
            <View style={ui.between}>
              <View style={{ flex: 1 }}>
                <Text style={type.title}>{t.name}</Text>
                <Text style={type.bodySm}>{t.type}{t.location ? ` · ${t.location}` : ''}</Text>
              </View>
              <Badge label={st.label} color={st.color} bg={st.bg} />
            </View>

            <View style={styles.tank}>
              <View style={[styles.water, { height: `${Math.max(4, st.p)}%`, backgroundColor: st.label === 'Critical' ? colors.coral : colors.primary }]}>
                <View style={styles.wave} />
              </View>
              <View style={styles.tankOverlay}>
                <Text style={styles.tankCaption}>VOLUME LEVEL</Text>
                <Text style={styles.tankValue}>{formatNumber(t.levelL)}<Text style={styles.tankOf}> / {compactLitres(t.capacityL)}</Text></Text>
              </View>
              <View style={styles.pctBubble}><Text style={[type.headline, { color: st.color }]}>{st.p}%</Text></View>
            </View>

            {history.length > 1 ? (
              <View>
                <Text style={type.caption}>Last {history.length} readings</Text>
                <View style={styles.spark}>
                  {history.map((h, i) => (
                    <View key={i} style={{ flex: 1, height: `${Math.max(4, (h.levelL / max) * 100)}%`, backgroundColor: i === history.length - 1 ? colors.primary : colors.cyanSoft, borderRadius: 2 }} />
                  ))}
                </View>
              </View>
            ) : null}

            <View style={[ui.row, { gap: 8 }]}>
              <Metric label="Quality pH" value={t.ph ?? '—'} />
              <Metric label="Turbidity" value={t.turbidity ?? '—'} sub="NTU" />
              <Metric label="Chlorine" value={t.chlorine ?? '—'} sub="ppm" />
            </View>
            <View style={ui.between}>
              <Text style={type.bodySm}>In {formatNumber(t.inflowLph)} L/h · Out {formatNumber(t.outflowLph)} L/h</Text>
              <Text style={type.bodySm}>{timeAgo(t.updatedAt)}</Text>
            </View>
            <View style={ui.actions}>
              <Button title="Edit tank" icon="create-outline" small variant="ghost" onPress={() => setEditing(t)} />
            </View>
          </Card>
        );
      })}

      {feed.length ? (
        <>
          <SectionHeader title="Live telemetry feed" subtitle="Auto-refresh every 8s" icon="pulse" />
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {feed.map((f, i) => (
              <View key={`${f.tank.id}${f.t}${i}`} style={[styles.feedRow, i === feed.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={[styles.feedDot, { backgroundColor: f.delta < 0 ? colors.amber : colors.mint }]} />
                <View style={{ flex: 1 }}>
                  <Text style={type.label}>{f.tank.name}</Text>
                  <Text style={type.bodySm}>{f.delta === 0 ? 'Reading' : f.delta > 0 ? `+${formatNumber(f.delta)} L` : `${formatNumber(f.delta)} L`}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[type.label, type.num, { color: colors.primary }]}>{litres(f.levelL)}</Text>
                  <Text style={type.bodySm}>{timeAgo(f.t)}</Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <TankSheet tank={editing} onClose={() => setEditing(null)} act={act} />
    </Screen>
  );
}

function Metric({ label, value, sub }) {
  return (
    <View style={styles.metric}>
      <Text style={[type.bodySm, { fontSize: 12 }]}>{label}</Text>
      <Text style={[type.title, type.num, { color: colors.primaryDeep }]}>{value}</Text>
      {sub ? <Text style={[type.bodySm, { fontSize: 11 }]}>{sub}</Text> : null}
    </View>
  );
}

function TankSheet({ tank, onClose, act }) {
  const isNew = tank && !tank.id;
  const [form, setForm] = useState({});
  const [key, setKey] = useState(null);
  const k = tank ? tank.id ?? 'new' : null;
  if (k !== key) {
    setKey(k);
    setForm(tank ? { name: tank.name ?? '', location: tank.location ?? '', type: tank.type ?? 'Storage tank', capacityL: tank.capacityL ? String(tank.capacityL) : '', levelL: '' } : {});
  }
  const set = (f) => (v) => setForm((s) => ({ ...s, [f]: v }));

  const save = async () => {
    const ok = await act((api) => (isNew ? api.post('/api/tanks', form) : api.patch(`/api/tanks/${tank.id}`, form)), isNew ? 'Tank added' : null);
    if (ok) onClose();
  };
  const remove = async () => {
    if (await confirm('Delete tank?', `${tank.name} and its reading history will be removed.`, 'Delete')) {
      if (await act((api) => api.del(`/api/tanks/${tank.id}`))) onClose();
    }
  };

  return (
    <Sheet visible={Boolean(tank)} onClose={onClose} title={isNew ? 'Add tank' : 'Edit tank'}
      footer={<View style={{ gap: 8 }}>
        <Button title={isNew ? 'Add tank' : 'Save changes'} icon="checkmark" onPress={save} />
        {!isNew ? <Button title="Delete tank" icon="trash-outline" variant="danger" onPress={remove} /> : null}
      </View>}>
      <Field label="Name" placeholder="Reservoir Alpha" value={form.name} onChangeText={set('name')} />
      <Field label="Location" placeholder="Borehole feeder, Nyali" value={form.location} onChangeText={set('location')} />
      <Field label="Type" placeholder="Reservoir / Storage tank / Borehole" value={form.type} onChangeText={set('type')} />
      <Field label="Capacity (litres)" keyboardType="numeric" value={form.capacityL} onChangeText={set('capacityL')} />
      {isNew ? <Field label="Current volume (litres)" keyboardType="numeric" value={form.levelL} onChangeText={set('levelL')} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  heroCaption: { color: colors.cyanSoft, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  heroValue: { color: colors.onPrimary, fontSize: 38, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  heroUnit: { fontSize: 18, fontWeight: '600', color: colors.cyanSoft },
  tank: { height: 130, borderRadius: radius.lg, backgroundColor: colors.surfaceLow, overflow: 'hidden', justifyContent: 'flex-end', borderWidth: 1, borderColor: colors.border },
  water: { width: '100%', opacity: 0.9 },
  wave: { position: 'absolute', top: -10, left: -20, right: -20, height: 20, borderRadius: 40, backgroundColor: colors.cyan, opacity: 0.6 },
  tankOverlay: { position: 'absolute', top: 12, left: 14 },
  tankCaption: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: colors.primaryDark },
  tankValue: { fontSize: 24, fontWeight: '800', color: colors.primaryDark, fontVariant: ['tabular-nums'] },
  tankOf: { fontSize: 14, fontWeight: '500' },
  pctBubble: { position: 'absolute', right: 12, top: 12, backgroundColor: colors.surface, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  spark: { height: 36, flexDirection: 'row', alignItems: 'flex-end', gap: 2, marginTop: 6 },
  metric: { flex: 1, backgroundColor: colors.surfaceLow, borderRadius: radius.md, padding: 8, alignItems: 'center' },
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  feedDot: { width: 8, height: 8, borderRadius: 4 },
});

