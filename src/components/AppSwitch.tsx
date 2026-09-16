import { Platform, Switch, type SwitchProps } from "react-native";
import { useTheme } from "@/components/ui";

/**
 * Wraps RN's core `Switch` with the platform-correct color props.
 *
 * Root cause of the iOS visual bug: passing `thumbColor` (and, historically,
 * `ios_backgroundColor`) on iOS forces the switch out of its native
 * rendering path — once `thumbColor` is set, iOS falls back to a custom-
 * drawn thumb that loses the real system switch's shape/shadow/animation,
 * so it looks visibly "off" compared to every other iOS switch on the
 * device (Android's Material switch has no such native/custom split, so
 * custom colors there always look correct). The fix is to only customize
 * `trackColor.true` on iOS and leave everything else native; Android keeps
 * the full custom palette it already had.
 */
export function AppSwitch(props: Omit<SwitchProps, "trackColor" | "thumbColor" | "ios_backgroundColor">) {
  const theme = useTheme();

  if (Platform.OS === "ios") {
    // RN's iOS Switch hardcodes `alignSelf: 'flex-start'` internally, which
    // overrides a parent row's `alignItems: 'center'` and pins the switch to
    // the top of any row taller than its own intrinsic height. Re-asserting
    // `alignSelf: 'center'` here (after props.style, so it wins) restores
    // proper flexbox centering without a fixed pixel offset.
    return (
      <Switch
        {...props}
        style={[{ alignSelf: "center" }, props.style]}
        trackColor={{ true: theme.colors.primary, false: undefined }}
      />
    );
  }

  return (
    <Switch
      {...props}
      trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
      thumbColor={theme.isDark ? theme.colors.ink : theme.colors.panel}
    />
  );
}
