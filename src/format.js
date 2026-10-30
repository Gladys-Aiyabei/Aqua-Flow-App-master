import { colors } from './theme';

const group = (n) => Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const kes = (n) => `KES ${group(n)}`;
export const litres = (n) => `${group(n)} L`;
export const compactLitres = (n) => (n >= 1000 ? `${+(n / 1000).toFixed(n % 1000 ? 1 : 0)}k L` : `${group(n)} L`);
export const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
export { group as formatNumber };

export function prettyPhone(p) {
  const s = String(p || '');
  return /^254\d{9}$/.test(s) ? `+254 ${s.slice(3, 6)} ${s.slice(6, 9)} ${s.slice(9)}` : s;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const isToday = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();

export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export function levelState(levelL, capacityL, lowPercent = 20) {
  const p = pct(levelL, capacityL);
  if (p < lowPercent) return { label: 'Critical', color: colors.danger, bg: colors.dangerSoft, p };
  if (p < lowPercent * 2) return { label: 'Low', color: colors.amber, bg: colors.amberSoft, p };
  return { label: 'Normal', color: colors.mintDeep, bg: colors.mintSoft, p };
}

// label + colours for every status value the API can return
export const STATUS = {
  // orders
  new: { label: 'New', color: colors.primary, bg: colors.primarySoft },
  confirmed: { label: 'Confirmed', color: colors.primaryDeep, bg: colors.surfaceMid },
  dispatched: { label: 'In transit', color: '#006A80', bg: colors.cyanSoft },
  delivered: { label: 'Delivered', color: colors.mintDeep, bg: colors.mintSoft },
  cancelled: { label: 'Cancelled', color: colors.danger, bg: colors.dangerSoft },
  // deliveries
  requested: { label: 'Requested', color: colors.amber, bg: colors.amberSoft },
  scheduled: { label: 'Scheduled', color: colors.primary, bg: colors.primarySoft },
  filling: { label: 'Filling', color: '#006A80', bg: colors.cyanSoft },
  en_route: { label: 'En route', color: colors.mintDeep, bg: colors.mintSoft },
  discharging: { label: 'Discharging', color: '#006A80', bg: colors.cyanSoft },
  // trucks
  idle: { label: 'Standby', color: colors.textMuted, bg: colors.surfaceMid },
  maintenance: { label: 'Maintenance', color: colors.danger, bg: colors.dangerSoft },
  // payments
  pending: { label: 'Pending', color: colors.amber, bg: colors.amberSoft },
  success: { label: 'Paid', color: colors.mintDeep, bg: colors.mintSoft },
  failed: { label: 'Failed', color: colors.danger, bg: colors.dangerSoft },
  paid: { label: 'Paid', color: colors.mintDeep, bg: colors.mintSoft },
  unpaid: { label: 'Unpaid', color: colors.danger, bg: colors.dangerSoft },
  // feedback
  open: { label: 'Open', color: colors.amber, bg: colors.amberSoft },
  resolved: { label: 'Replied', color: colors.mintDeep, bg: colors.mintSoft },
};
export const statusOf = (s) => STATUS[s] ?? { label: s, color: colors.textMuted, bg: colors.surfaceMid };

/** 254712345678 -> "0712 345 678" for editable phone fields. */
export function localPhone(p) {
  const s = String(p || '');
  return /^254\d{9}$/.test(s) ? `0${s.slice(3, 6)} ${s.slice(6, 9)} ${s.slice(9)}` : s;
}

/** Local calendar day as YYYY-MM-DD (daysAgo = 1 for yesterday). */
export function dateKey(daysAgo = 0) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function prettyDate(key) {
  if (key === dateKey(0)) return 'Today';
  if (key === dateKey(1)) return 'Yesterday';
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Signed litres, e.g. "+1,200 L" / "−3,000 L". */
export const signedLitres = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${group(Math.abs(n))} L`;
