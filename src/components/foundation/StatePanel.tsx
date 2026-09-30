import { AppText } from "@/components/foundation/AppText";
import { Button, useTheme } from "@/components/ui";
import { layout, radius, spacing } from "@/lib/designTokens";
import type { StatusTone } from "@/lib/themePalette";
import { SymbolView } from "expo-symbols";
import { View } from "react-native";

export type StatePanelVariant = "empty" | "error" | "unavailable" | "info";

type Action = { label: string; onPress: () => void; accessibilityHint?: string };

type Props = {
  variant?: StatePanelVariant;
  title: string;
  message?: string;
  /** e.g. Retry. The panel never fetches; the owning screen supplies the handler. */
  action?: Action;
  secondaryAction?: Action;
};

const ICONS: Record<StatePanelVariant, { ios: string; android: string; web: string }> = {
  empty: { ios: "tray", android: "inbox", web: "inbox" },
  error: { ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" },
  unavailable: { ios: "clock", android: "schedule", web: "schedule" },
  info: { ios: "info.circle", android: "info", web: "info" },
};

const TONES: Record<StatePanelVariant, StatusTone> = {
  empty: "neutral",
  error: "danger",
  unavailable: "neutral",
  info: "info",
};

/** Empty / error / unavailable presentation with optional actions. */
export function StatePanel({ variant = "empty", title, message, action, secondaryAction }: Props) {
  const theme = useTheme();
  const tone = theme.colors.tones[TONES[variant]];
  return (
    <View
      style={[local.panel, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}
      // Single announcement owner: a recoverable error is announced politely
      // (Android live region, web aria-live). No child uses the assertive
      // `alert` role. Other states are static content.
      accessibilityLiveRegion={variant === "error" ? "polite" : "none"}
    >
      {variant === "empty" ? null : (
        // v3 empty states are text-only; the other variants keep an identifying icon.
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={[local.icon, { backgroundColor: tone.bg }]}
        >
          <SymbolView name={ICONS[variant] as never} size={22} tintColor={tone.fg} fallback={<View />} />
        </View>
      )}
      <AppText variant="bodyStrong" align="center" accessibilityRole="header" style={local.title}>
        {title}
      </AppText>
      {message ? <AppText variant="body" tone="muted" align="center" style={local.message}>{message}</AppText> : null}
      {action || secondaryAction ? (
        <View style={local.actions}>
          {action ? <Button title={action.label} onPress={action.onPress} accessibilityHint={action.accessibilityHint} /> : null}
          {secondaryAction ? (
            <Button
              title={secondaryAction.label}
              variant="secondary"
              onPress={secondaryAction.onPress}
              accessibilityHint={secondaryAction.accessibilityHint}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const local = {
  panel: {
    width: "100%" as const,
    maxWidth: layout.readableWidth,
    alignSelf: "center" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    // v3 state card: padding 28 20, radius 20, `--shadow`, no border.
    paddingVertical: 28,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.xl,
  },
  title: { fontSize: 17, lineHeight: 22 },
  message: { fontSize: 14, lineHeight: 20 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    marginBottom: spacing.xs,
  },
  actions: { alignSelf: "stretch" as const, gap: spacing.sm, marginTop: spacing.sm },
};
