import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../../AppContext';
import { colors, type } from '../../theme';
import { prettyPhone, timeAgo } from '../../format';
import { Badge, Button, Card, Empty, Field, IconButton, ProgressBar, Screen, SectionHeader, Segmented, Sheet, Stars, ui } from '../../components/ui';

export default function FeedbackScreen() {
  const { data, act } = useApp();
  const [filter, setFilter] = useState('open');
  const [replying, setReplying] = useState(null);
  const [reply, setReply] = useState('');

  const all = data?.feedback ?? [];
  const avg = all.length ? all.reduce((s, f) => s + f.rating, 0) / all.length : 0;
  const shown = filter === 'all' ? all : all.filter((f) => f.status === filter);

  const send = async () => {
    if (await act((api) => api.patch(`/api/feedback/${replying.id}`, { reply }), 'Reply sent to customer')) { setReplying(null); setReply(''); }
  };

  return (
    <Screen>
      <Card>
        <View style={[ui.row, { gap: 16 }]}>
          <View style={{ alignItems: 'center' }}>
            <Text style={[type.display, { color: colors.primaryDeep }]}>{avg.toFixed(1)}</Text>
            <Stars value={Math.round(avg)} />
            <Text style={type.bodySm}>{all.length} reviews</Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            {[5, 4, 3, 2, 1].map((n) => {
              const c = all.filter((f) => f.rating === n).length;
              return (
                <View key={n} style={[ui.row, { gap: 8 }]}>
                  <Text style={[type.bodySm, { width: 12 }]}>{n}</Text>
                  <View style={{ flex: 1 }}><ProgressBar value={all.length ? (c / all.length) * 100 : 0} color={colors.star} height={6} /></View>
                  <Text style={[type.bodySm, { width: 22, textAlign: 'right' }]}>{c}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </Card>

      <SectionHeader title="Customer feedback" subtitle="Reply to close the loop" icon="chatbubbles" />
      <Segmented value={filter} onChange={setFilter} options={[
        { value: 'open', label: 'Needs reply', count: all.filter((f) => f.status === 'open').length },
        { value: 'resolved', label: 'Replied', count: all.filter((f) => f.status === 'resolved').length },
        { value: 'all', label: 'All', count: all.length },
      ]} />
      {shown.length === 0 ? <Empty icon="chatbubbles-outline" title="All caught up" text="New feedback from customers shows up here." /> : null}
      {shown.map((f) => (
        <Card key={f.id} accent={f.rating <= 2 ? colors.danger : f.status === 'open' ? colors.amber : undefined}>
          <View style={ui.between}>
            <View style={{ flex: 1 }}>
              <Text style={type.label}>{f.customerName}{f.location ? ` (${f.location})` : ''}</Text>
              <Text style={type.bodySm}>{f.category} · {timeAgo(f.createdAt)}{f.orderId ? ` · ${f.orderId}` : ''}</Text>
            </View>
            <Stars value={f.rating} size={14} />
          </View>
          <Text style={[type.body, { fontStyle: 'italic' }]}>“{f.message}”</Text>
          {f.reply ? (
            <View style={styles.reply}>
              <Text style={[type.caption, { color: colors.primary }]}>Your reply</Text>
              <Text style={type.body}>{f.reply}</Text>
            </View>
          ) : null}
          <View style={ui.actions}>
            <Badge status={f.status} />
            <View style={{ flex: 1 }} />
            {f.customerPhone ? <IconButton icon="call" label="Call" onPress={() => Linking.openURL(`tel:+${f.customerPhone}`)} /> : null}
            <Button small title={f.reply ? 'Edit reply' : 'Reply'} icon="arrow-undo" onPress={() => { setReplying(f); setReply(f.reply ?? ''); }} />
          </View>
        </Card>
      ))}

      <Sheet visible={Boolean(replying)} onClose={() => setReplying(null)} title={`Reply to ${replying?.customerName ?? ''}`}
        subtitle={replying ? `${prettyPhone(replying.customerPhone)} · they will see this in their app` : ''}
        footer={<Button title="Send reply" icon="send" onPress={send} disabled={!reply.trim()} />}>
        {replying ? <Text style={[type.body, { fontStyle: 'italic' }]}>“{replying.message}”</Text> : null}
        <Field label="Your reply" multiline value={reply} onChangeText={setReply} placeholder="Thank you for your feedback…" />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  reply: { backgroundColor: colors.surfaceLow, borderRadius: 12, padding: 10, gap: 4, borderLeftWidth: 3, borderLeftColor: colors.primary },
});
