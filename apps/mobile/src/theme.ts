import { StyleSheet } from 'react-native';

/**
 * Design tokens for the mobile app.
 *
 * Structure, spacing and component anatomy follow the Figma file
 * (390×844 Arabic/RTL screens). The palette stays on the product's existing
 * brand teal — Figma's exact colour values were not retrievable, so rather
 * than guess at them we keep the tokens already used across web and mobile.
 */

export const colors = {
  brand: '#0f766e',
  brandDark: '#0b544e',
  brandSoft: '#ccfbf1',
  bg: '#f8fafc',
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#0f172a',
  muted: '#64748b',
  faint: '#94a3b8',
  danger: '#b91c1c',
  dangerBg: '#fef2f2',
  dangerBorder: '#fecaca',
  warn: '#92400e',
  warnBg: '#fffbeb',
  success: '#065f46',
  successBg: '#ecfdf5',
  bubbleUser: '#0f766e',
  bubbleAi: '#ffffff',
};

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  container: { padding: space.lg, paddingBottom: space.xl },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    marginBottom: space.md,
  },

  h1: { fontSize: 22, fontWeight: '700', color: colors.text },
  h2: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
  body: { color: colors.text, fontSize: 14, lineHeight: 20 },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    fontSize: 15,
    backgroundColor: colors.card,
    color: colors.text,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: space.xs,
  },

  btn: {
    backgroundColor: colors.brand,
    borderRadius: radius.sm,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnText: { color: 'white', fontWeight: '700', fontSize: 15 },
  btnSecondary: {
    borderRadius: radius.sm,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  btnSecondaryText: { color: colors.text, fontWeight: '600', fontSize: 14 },

  /** Small rounded pill used across the Figma header and filter rows. */
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipText: { fontSize: 11, fontWeight: '600', color: colors.muted },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipActiveText: { color: 'white' },

  /** Figma "KPI" tile — big number over a caption. */
  kpi: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  kpiValue: { fontSize: 26, fontWeight: '700', color: colors.text },
  kpiLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },

  /** Chat bubbles (Figma 03). */
  bubbleUser: {
    backgroundColor: colors.bubbleUser,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    maxWidth: '78%',
  },
  bubbleUserText: { color: 'white', fontSize: 14, lineHeight: 20 },
  bubbleAi: {
    backgroundColor: colors.bubbleAi,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    maxWidth: '86%',
  },
  bubbleRefused: {
    backgroundColor: colors.warnBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#fde68a',
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    maxWidth: '86%',
  },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  avatarText: { fontSize: 11, fontWeight: '700', color: colors.brandDark },

  /** Bottom navigation bar (Figma). */
  bottomNav: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: space.sm,
  },
  navItem: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  navDot: { width: 5, height: 5, borderRadius: radius.pill, marginBottom: 4 },
  navLabel: { fontSize: 11, color: colors.muted },
  navLabelActive: { color: colors.brand, fontWeight: '700' },

  /** Thin progress/confidence bar. */
  bar: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
    flex: 1,
  },
  barFill: { height: 4, borderRadius: radius.pill, backgroundColor: colors.brand },

  divider: { height: 1, backgroundColor: colors.border },

  /** Governed clinical strings are rendered RTL regardless of UI language. */
  arabic: { textAlign: 'right', writingDirection: 'rtl', fontSize: 14, lineHeight: 22 },
});
