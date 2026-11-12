import { useState } from 'react';
import { Text, View } from 'react-native';
import { confirm, useApp } from '../../AppContext';
import { colors, type } from '../../theme';
import { localPhone, prettyPhone, timeAgo } from '../../format';
import { Badge, Button, Card, ChoiceGrid, Empty, Field, InfoRow, Screen, SectionHeader, Segmented, Sheet, ui } from '../../components/ui';

const ROLE_BADGE = {
  admin: { label: 'Admin', color: colors.onPrimary, bg: colors.primaryDeep },
  staff: { label: 'Staff', color: colors.primaryDeep, bg: colors.primarySoft },
  customer: { label: 'Customer', color: colors.mintDeep, bg: colors.mintSoft },
};

/** A temporary password the admin can read out or text to a new staff member. */
function tempPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const pick = (set) => {
    const n = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 1e9);
    return set[n % set.length];
  };
  return `${Array.from({ length: 6 }, () => pick(letters)).join('')}${pick(digits)}${pick(digits)}${pick(digits)}`;
}

export default function TeamScreen() {
  const { data, act, session } = useApp();
  const [tab, setTab] = useState('team');
  const [editing, setEditing] = useState(null); // user being edited, or {} for new staff
  const [branchForm, setBranchForm] = useState(null);
  const users = data?.users ?? [];
  const branches = data?.branches ?? [];
  const branchLabel = (id) => { const b = branches.find((x) => x.id === id); return b ? `${b.code} · ${b.name}` : 'No branch'; };
  const team = users.filter((u) => u.role !== 'customer');
  const customers = users.filter((u) => u.role === 'customer');

  const toggleActive = async (u) => {
    const off = u.active;
    if (await confirm(off ? `Deactivate ${u.name}?` : `Reactivate ${u.name}?`,
      off ? 'They will be signed out at once and cannot log in until reactivated.' : 'They will be able to log in again.', off ? 'Deactivate' : 'Reactivate')) {
      act((api) => api.patch(`/api/users/${u.id}`, { active: !off }), off ? 'Account deactivated' : 'Account reactivated');
    }
  };

  const userCard = (u) => (
    <Card key={u.id} accent={!u.active ? colors.danger : u.role === 'admin' ? colors.primaryDeep : colors.primary} style={!u.active && { opacity: 0.7 }}>
      <View style={ui.between}>
        <View style={{ flex: 1 }}>
          <Text style={type.title}>{u.name}{u.id === session?.id ? ' (you)' : ''}</Text>
          <Text style={type.bodySm} numberOfLines={1}>{u.email}</Text>
        </View>
        <Badge {...ROLE_BADGE[u.role]} />
      </View>
      <View style={ui.inset}>
        {u.role !== 'admin' ? <InfoRow icon="git-branch">{branchLabel(u.branchId)}</InfoRow> : <InfoRow icon="globe">All branches</InfoRow>}
        {u.phone ? <InfoRow icon="call">{prettyPhone(u.phone)}</InfoRow> : null}
        <InfoRow icon="time">{u.lastLoginAt ? `Last signed in ${timeAgo(u.lastLoginAt)}` : 'Never signed in'}</InfoRow>
        {!u.active ? <InfoRow icon="ban" color={colors.danger}>Deactivated</InfoRow> : u.mustChangePassword ? <InfoRow icon="key" color={colors.amber}>Waiting to set their own password</InfoRow> : null}
      </View>
      <View style={ui.actions}>
        <Button small variant="ghost" icon="create-outline" title="Edit" onPress={() => setEditing(u)} style={{ flex: 1 }} />
        {u.id !== session?.id ? (
          <Button small variant={u.active ? 'danger' : 'outline'} icon={u.active ? 'ban' : 'checkmark-circle'} title={u.active ? 'Deactivate' : 'Reactivate'} onPress={() => toggleActive(u)} style={{ flex: 1 }} />
        ) : null}
      </View>
    </Card>
  );

  return (
    <Screen>
      <Segmented value={tab} onChange={setTab} options={[
        { value: 'team', label: 'Staff & admins', count: team.length },
        { value: 'branches', label: 'Branches', count: branches.length },
        { value: 'customers', label: 'Customers', count: data?.counts?.customers ?? customers.length },
      ]} />

      {tab === 'team' ? (
        <>
          <Button title="Add staff member" icon="person-add" onPress={() => setEditing({})} />
          <Text style={type.bodySm}>Staff only see the branch you assign them to. New accounts get a temporary password and must set their own when they first log in.</Text>
          {team.length === 0 ? <Empty icon="people-outline" title="No staff yet" text="Add the people who run your branches." /> : null}
          {team.map(userCard)}
        </>
      ) : null}

      {tab === 'branches' ? (
        <>
          <SectionHeader title="Distribution branches" subtitle="Routes or depots that staff are assigned to" icon="git-branch" action="Add branch" onAction={() => setBranchForm({})} />
          {branches.length === 0 ? <Empty icon="git-branch-outline" title="No branches yet" text="Add your first route, e.g. DIS-1." /> : null}
          {branches.map((b) => {
            const staff = team.filter((u) => u.branchId === b.id && u.active);
            return (
              <Card key={b.id} accent={b.active ? colors.primary : colors.surfaceHigh} style={!b.active && { opacity: 0.6 }}>
                <View style={ui.between}>
                  <View style={{ flex: 1 }}>
                    <Text style={type.title}>{b.code} · {b.name}</Text>
                    <Text style={type.bodySm}>{b.area || 'No area set'}</Text>
                  </View>
                  {!b.active ? <Badge label="Closed" color={colors.danger} bg={colors.dangerSoft} /> : null}
                </View>
                <InfoRow icon="people">{staff.length ? staff.map((s) => s.name).join(', ') : 'No staff assigned'}</InfoRow>
                <Button small variant="ghost" icon="create-outline" title="Edit branch" onPress={() => setBranchForm(b)} />
              </Card>
            );
          })}
        </>
      ) : null}

      {tab === 'customers' ? (
        <>
          <Text style={type.bodySm}>Customers sign up themselves. You can correct details, reset a forgotten password or deactivate an account.</Text>
          {customers.length === 0 ? <Empty icon="people-outline" title="No customers yet" /> : null}
          {customers.slice(0, 100).map(userCard)}
        </>
      ) : null}

      <UserSheet user={editing} branches={branches} onClose={() => setEditing(null)} />
      <BranchSheet branch={branchForm} onClose={() => setBranchForm(null)} />
    </Screen>
  );
}

function UserSheet({ user, branches, onClose }) {
  const { act } = useApp();
  const isNew = user && !user.id;
  const [form, setForm] = useState({});
  const [key, setKey] = useState(null);
  const k = user ? user.id ?? 'new' : null;
  if (k !== key) {
    setKey(k);
    setForm(user ? {
      name: user.name ?? '', email: user.email ?? '', phone: user.phone ? localPhone(user.phone) : '',
      role: user.role ?? 'staff', branchId: user.branchId ?? branches.find((b) => b.active)?.id ?? null,
      password: isNew ? tempPassword() : '',
    } : {});
  }
  const set = (f) => (v) => setForm((s) => ({ ...s, [f]: v }));

  const save = async () => {
    const body = isNew
      ? { name: form.name, email: form.email, phone: form.phone, role: form.role, branchId: form.role === 'staff' ? form.branchId : null, password: form.password }
      : {
        name: form.name, phone: form.phone,
        ...(user.role !== 'customer' ? { role: form.role, branchId: form.role === 'staff' ? form.branchId : null } : {}),
        ...(user.role === 'customer' && form.branchId !== user.branchId ? { branchId: form.branchId } : {}),
        ...(form.password ? { password: form.password } : {}),
      };
    const msg = isNew
      ? `Account created for ${form.email}.\n\nTemporary password: ${form.password}\n\nShare it privately. They must change it when they first log in.`
      : form.password ? `Saved. New temporary password: ${form.password}\n\nThey have been signed out and must change it at next login.` : 'Saved';
    if (await act((api) => (isNew ? api.post('/api/users', body) : api.patch(`/api/users/${user.id}`, body)), msg)) onClose();
  };

  const roleOptions = [{ value: 'staff', label: 'Staff', sub: 'One branch only' }, { value: 'admin', label: 'Admin', sub: 'Everything' }];
  const showBranch = form.role === 'staff' || user?.role === 'customer';

  return (
    <Sheet visible={Boolean(user)} onClose={onClose} title={isNew ? 'Add staff member' : `Edit ${user?.name ?? ''}`}
      subtitle={isNew ? 'They log in with this email and the temporary password' : user?.email}
      footer={<Button title={isNew ? 'Create account' : 'Save changes'} icon="checkmark" onPress={save} />}>
      <Field label="Full name" value={form.name} onChangeText={set('name')} autoCapitalize="words" />
      {isNew ? <Field label="Email (used to log in)" value={form.email} onChangeText={set('email')} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" /> : null}
      <Field label="Phone (optional)" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="0712 345 678" />
      {user?.role !== 'customer' ? (<><Text style={type.caption}>Role</Text><ChoiceGrid columns={2} value={form.role} onChange={set('role')} options={roleOptions} /></>) : null}
      {showBranch ? (
        <>
          <Text style={type.caption}>{user?.role === 'customer' ? 'Delivery area' : 'Branch / route'}</Text>
          {branches.length ? (
            <ChoiceGrid columns={2} value={form.branchId} onChange={set('branchId')} options={branches.map((b) => ({ value: b.id, label: b.code, sub: b.name, disabled: !b.active }))} />
          ) : <Text style={[type.bodySm, { color: colors.danger }]}>Add a branch first (Branches tab).</Text>}
        </>
      ) : null}
      <Field label={isNew ? 'Temporary password' : 'Reset password (leave blank to keep)'} value={form.password} onChangeText={set('password')} autoCapitalize="none" autoCorrect={false} />
      <Button small variant="ghost" icon="refresh" title="Generate a password" onPress={() => set('password')(tempPassword())} />
    </Sheet>
  );
}

function BranchSheet({ branch, onClose }) {
  const { act } = useApp();
  const isNew = branch && !branch.id;
  const [form, setForm] = useState({});
  const [key, setKey] = useState(null);
  const k = branch ? branch.id ?? 'new' : null;
  if (k !== key) {
    setKey(k);
    setForm(branch ? { code: branch.code ?? '', name: branch.name ?? '', area: branch.area ?? '', active: branch.active ?? true } : {});
  }
  const set = (f) => (v) => setForm((s) => ({ ...s, [f]: v }));
  const save = async () => {
    if (await act((api) => (isNew ? api.post('/api/branches', form) : api.patch(`/api/branches/${branch.id}`, form)), isNew ? 'Branch added' : 'Branch saved')) onClose();
  };
  return (
    <Sheet visible={Boolean(branch)} onClose={onClose} title={isNew ? 'Add branch' : `Edit ${branch?.code ?? ''}`}
      footer={<Button title="Save" icon="checkmark" onPress={save} />}>
      <View style={[ui.row, { gap: 8 }]}>
        <Field style={{ flex: 1 }} label="Code" placeholder="DIS-3" value={form.code} onChangeText={set('code')} autoCapitalize="characters" />
        <Field style={{ flex: 2 }} label="Name" placeholder="Kisauni route" value={form.name} onChangeText={set('name')} />
      </View>
      <Field label="Area served" placeholder="Estates and roads on this route" value={form.area} onChangeText={set('area')} />
      {!isNew ? (
        <ChoiceGrid columns={2} value={form.active} onChange={set('active')} options={[{ value: true, label: 'Open' }, { value: false, label: 'Closed', sub: 'Hidden from sign-up' }]} />
      ) : null}
    </Sheet>
  );
}
