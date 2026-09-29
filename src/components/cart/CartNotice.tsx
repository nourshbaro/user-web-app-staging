import { AppText } from "@/components/foundation";
import { Button, useTheme } from "@/components/ui";
import { radius, spacing } from "@/lib/designTokens";
import type { StatusTone } from "@/lib/themePalette";
import { View } from "react-native";

/**
 * Inline, recoverable notice with one action (e.g. "Refresh cart"). The
 * action is the owner's own operation passed in by the screen; the notice
 * holds no state. Announced politely when it appears.
 */
export function CartNotice({
  tone = "warning",
  message,
  action,
}: {
  tone?: StatusTone;
  message: string;
  action?: { label: string; busy?: boolean; disabled?: boolean; onPress: () => void };
}) {
  const theme = useTheme();
  const colors = theme.colors.tones[tone];
  return (
    <View
      style={[local.notice, { backgroundColor: colors.bg, borderColor: colors.border }]}
      accessibilityLiveRegion="polite"
    >
      <AppText variant="meta" style={{ color: colors.fg }}>{message}</AppText>
      {action ? (
        <Button
          title={action.label}
          variant="secondary"
          loading={action.busy}
          disabled={action.disabled}
          onPress={action.onPress}
        />
      ) : null}
    </View>
  );
}

const local = {
  notice: { borderRadius: radius.md, borderWidth: 1, padding: spacing.md, gap: spacing.sm },
};
