// "Aquatic Precision" design tokens (see ../aquatic_precision/DESIGN.md)
import { Platform } from 'react-native';

export const colors = {
  canvas: '#F0F7FA',
  surface: '#FFFFFF',
  surfaceLow: '#ECF4FF',
  surfaceMid: '#E2EFFF',
  surfaceHigh: '#D4E4F6',
  border: '#E0F2FE',
  borderStrong: '#D0E5F2',
  divider: 'rgba(0, 119, 182, 0.08)',

  primary: '#0077B6',
  primaryDeep: '#005D90',
  primaryDark: '#004B74',
  primarySoft: '#CDE5FF',
  cyan: '#00B4D8',
  cyanSoft: '#B3EBFF',
  cyanWash: 'rgba(0, 180, 216, 0.10)',
  mint: '#00A86B',
  mintDeep: '#00663F',
  mintSoft: 'rgba(0, 168, 107, 0.12)',
  amber: '#E89B0C',
  amberSoft: 'rgba(232, 155, 12, 0.14)',
  coral: '#FF6B6B',
  danger: '#BA1A1A',
  dangerSoft: '#FFDAD6',

  text: '#0F1F2C',
  textMuted: 'rgba(15, 31, 44, 0.68)',
  textFaint: 'rgba(15, 31, 44, 0.45)',
  onPrimary: '#FFFFFF',
  star: '#F5A524',
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, full: 999 };
export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

const tabular = { fontVariant: ['tabular-nums'] };
export const type = {
  display: { fontSize: 34, fontWeight: '700', letterSpacing: -1, color: colors.text, ...tabular },
  metric: { fontSize: 30, fontWeight: '700', letterSpacing: -0.8, color: colors.text, ...tabular },
  headline: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, color: colors.text },
  title: { fontSize: 17, fontWeight: '600', letterSpacing: -0.2, color: colors.text },
  body: { fontSize: 15, lineHeight: 21, color: colors.text },
  bodySm: { fontSize: 13, lineHeight: 18, color: colors.textMuted },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  caption: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: colors.textMuted },
  num: tabular,
};

export const shadow = Platform.select({
  ios: { shadowColor: '#0077B6', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  android: { elevation: 2 },
  default: { boxShadow: '0px 4px 16px -2px rgba(0, 119, 182, 0.08)' },
});

export const shadowStrong = Platform.select({
  ios: { shadowColor: '#0077B6', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
  android: { elevation: 6 },
  default: { boxShadow: '0px 12px 28px -4px rgba(0, 119, 182, 0.2)' },
});
