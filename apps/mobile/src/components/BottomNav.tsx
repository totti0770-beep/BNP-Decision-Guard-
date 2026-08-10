import { Text, TouchableOpacity, View } from 'react-native';
import { row, t, type Key, type Lang } from '../i18n';
import { colors, s } from '../theme';

export type Tab = 'home' | 'chat' | 'doses' | 'audit' | 'sources';

export interface TabDef {
  key: Tab;
  label: Key;
  /** Permission required to see the tab; undefined means always visible. */
  permission?: string;
}

/**
 * Figma bottom nav. The design's "الحوكمة / Governance" slot is replaced by the
 * real Dose Calculator — the governance screen's metrics (trust index, risk map,
 * protocol coverage) have no backing API, whereas dose calculation is a real,
 * clinically important feature that was otherwise unreachable from the nav.
 */
export const TABS: TabDef[] = [
  { key: 'home', label: 'home' },
  { key: 'chat', label: 'chat', permission: 'ai:ask' },
  { key: 'doses', label: 'doses', permission: 'dose:calculate' },
  { key: 'audit', label: 'audit', permission: 'audit:read' },
  { key: 'sources', label: 'sources', permission: 'documents:read' },
];

export function BottomNav({
  active,
  onChange,
  lang,
  permissions,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
  lang: Lang;
  permissions: string[];
}) {
  const visible = TABS.filter((tab) => !tab.permission || permissions.includes(tab.permission));

  return (
    <View style={[s.bottomNav, { flexDirection: row(lang) }]}>
      {visible.map((tab) => {
        const isActive = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            style={s.navItem}
            onPress={() => onChange(tab.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            <View
              style={[
                s.navDot,
                { backgroundColor: isActive ? colors.brand : 'transparent' },
              ]}
            />
            <Text style={[s.navLabel, isActive && s.navLabelActive]}>
              {t(lang, tab.label)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
