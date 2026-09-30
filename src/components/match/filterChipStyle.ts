/**
 * Dynamic styles for the Matches filter chips (v3). Pure module (no React
 * Native imports), so the renderer diff can be tested under Node.
 *
 * Processed style keys (`transform`, `boxShadow`, `fontVariant`, …) are only
 * ever INCLUDED when they have a value — never written as `key: undefined`.
 * React Native's diff (`restoreDeletedValuesInNestedArray`) turns an explicit
 * `undefined` into `null` and passes it to the key's processor; for
 * `transform` that is `processTransform(null)` → `null.forEach` in development
 * builds, which crashed every filter chip on press release.
 */
type ChipColors = { textStrong: string; surface: string; shadowCard: string };

export function filterChipStyle({ selected, pressed, colors }: { selected: boolean; pressed: boolean; colors: ChipColors }) {
  return {
    // v3: selected = filled ink; unselected cards carry `--shadow`.
    backgroundColor: selected ? colors.textStrong : colors.surface,
    ...(selected ? null : { boxShadow: colors.shadowCard }),
    // v3 `:active` scale(.96).
    ...(pressed ? { transform: [{ scale: 0.96 }] } : null),
  };
}

/** Date chips (v3): same fill/shadow rule; press feedback is opacity. */
export function dateChipStyle({ selected, pressed, colors }: { selected: boolean; pressed: boolean; colors: ChipColors }) {
  return {
    backgroundColor: selected ? colors.textStrong : colors.surface,
    ...(selected ? null : { boxShadow: colors.shadowCard }),
    opacity: pressed ? 0.85 : 1,
  };
}
