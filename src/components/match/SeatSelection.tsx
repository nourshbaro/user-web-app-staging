import { AppText } from "@/components/foundation";
import { Button, useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { radius, size, spacing } from "@/lib/designTokens";
import type { ThemeColors } from "@/lib/themePalette";
import type { SeatVisualState } from "@/lib/ticketSelection";
import { SymbolView } from "expo-symbols";
import { Pressable, View, type ViewStyle } from "react-native";

/*
 * Presentation-only pieces around the real seat map. Seat data, availability
 * and the draft selection belong to the Match Details screen (and the backend);
 * these components only render what they are given.
 */

/**
 * Seat marker appearance per state. Each state differs in shape or fill as
 * well as colour, so the map never relies on colour alone:
 * available = filled circle, selected = ringed circle with a centre mark,
 * in cart = rounded square, unavailable = hollow circle.
 */
export function seatGlyphStyle(state: SeatVisualState, colors: ThemeColors, seatSize: number): ViewStyle {
  const base: ViewStyle = { width: seatSize, height: seatSize, borderRadius: seatSize / 2, borderWidth: 1 };
  switch (state) {
    case "selected":
      return { ...base, backgroundColor: colors.actionPrimary, borderWidth: Math.max(2, seatSize * 0.14), borderColor: colors.onActionPrimary };
    case "inCart":
      return { ...base, borderRadius: seatSize * 0.22, backgroundColor: colors.gold, borderWidth: 2, borderColor: colors.surface };
    case "unavailable":
      return { ...base, backgroundColor: "transparent", borderWidth: 2, borderColor: colors.textMuted, opacity: 0.75 };
    default:
      return { ...base, backgroundColor: colors.tones.success.fg, borderColor: colors.surface };
  }
}

/** Centre mark that makes a selected seat distinguishable without colour. */
export function SelectedSeatMark({ seatSize }: { seatSize: number }) {
  const theme = useTheme();
  const markSize = Math.max(4, Math.round(seatSize * 0.3));
  return (
    <View
      pointerEvents="none"
      style={{ width: markSize, height: markSize, borderRadius: markSize / 2, backgroundColor: theme.colors.onActionPrimary }}
    />
  );
}

export function SeatLegend() {
  const theme = useTheme();
  const i18n = useI18n();
  const items: { state: SeatVisualState; label: string }[] = [
    { state: "available", label: i18n.t("seats.legend.available") },
    { state: "selected", label: i18n.t("seats.legend.selected") },
    { state: "inCart", label: i18n.t("seats.legend.inCart") },
    { state: "unavailable", label: i18n.t("seats.legend.unavailable") },
  ];
  return (
    <View style={local.legend}>
      {items.map((item) => (
        <View key={item.state} style={local.legendItem}>
          <View
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={[seatGlyphStyle(item.state, theme.colors, 16), local.centered]}
          >
            {item.state === "selected" ? <SelectedSeatMark seatSize={16} /> : null}
          </View>
          <AppText variant="caption" tone="muted">{item.label}</AppText>
        </View>
      ))}
    </View>
  );
}

export function SeatZoomControls({
  zoom,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
}: {
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const theme = useTheme();
  const i18n = useI18n();
  const button = (label: string, enabled: boolean, onPress: () => void, icon: { ios: string; android: string; web: string }) => (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      aria-disabled={!enabled}
      style={({ pressed }) => [
        local.zoomButton,
        { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
        !enabled && { backgroundColor: theme.colors.disabledSurface },
        pressed && enabled && { opacity: 0.8 },
      ]}
    >
      <SymbolView
        name={icon as never}
        size={size.iconMd}
        tintColor={enabled ? theme.colors.textStrong : theme.colors.disabledText}
        fallback={<View />}
      />
    </Pressable>
  );
  return (
    <View style={local.zoomRow}>
      {button(i18n.t("seats.zoomOut"), canZoomOut, onZoomOut, { ios: "minus.magnifyingglass", android: "zoom_out", web: "zoom_out" })}
      <AppText variant="label" tone="muted" style={local.zoomValue} accessibilityLiveRegion="polite">
        {i18n.t("seats.zoomLevel", { percent: Math.round(zoom * 100) })}
      </AppText>
      {button(i18n.t("seats.zoomIn"), canZoomIn, onZoomIn, { ios: "plus.magnifyingglass", android: "zoom_in", web: "zoom_in" })}
    </View>
  );
}

export type SummarySeat = { id: number; label: string };

/**
 * Pre-mutation summary of the draft seat selection: real seat labels from the
 * backend seat data, the zone's unit price and a display-only subtotal.
 */
export function SeatSelectionSummary({
  seats,
  count,
  zoneName,
  unitPriceLabel,
  subtotalLabel,
  disabled,
  onRemove,
  onClear,
}: {
  seats: SummarySeat[];
  count: number;
  zoneName: string;
  unitPriceLabel: string;
  subtotalLabel: string | null;
  disabled: boolean;
  onRemove: (seatId: number) => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  const i18n = useI18n();

  if (!count) {
    return (
      <View style={[local.summary, { backgroundColor: theme.colors.surfaceSecondary }]}>
        <AppText variant="meta" tone="muted">{i18n.t("seats.summary.empty")}</AppText>
      </View>
    );
  }

  return (
    <View style={[local.summary, { backgroundColor: theme.colors.surfaceSecondary }]}>
      <View style={local.summaryHeader}>
        <View style={local.summaryCopy}>
          <AppText variant="label" accessibilityRole="header">{i18n.t("seats.summary.title")}</AppText>
          <AppText variant="caption" tone="muted">
            {`${zoneName} · ${i18n.plural("tickets.selected", count)} · ${unitPriceLabel} ${i18n.t("tickets.perSeat")}`}
          </AppText>
        </View>
        {subtotalLabel ? <AppText variant="numeric">{subtotalLabel}</AppText> : null}
      </View>
      <View style={local.chips}>
        {seats.map((seat) => (
          <Pressable
            key={seat.id}
            onPress={() => onRemove(seat.id)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={i18n.t("seats.summary.remove", { seat: seat.label })}
            aria-disabled={disabled}
            style={({ pressed }) => [
              local.seatChip,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.tones.brand.border },
              pressed && { opacity: 0.8 },
            ]}
          >
            <AppText variant="label" numberOfLines={1} style={local.shrink}>{seat.label}</AppText>
            <SymbolView
              name={{ ios: "xmark", android: "close", web: "close" }}
              size={size.iconSm}
              tintColor={theme.colors.textMuted}
              fallback={<View />}
            />
          </Pressable>
        ))}
      </View>
      <Button title={i18n.t("seats.summary.clear")} variant="secondary" disabled={disabled} onPress={onClear} />
    </View>
  );
}

const local = {
  centered: { alignItems: "center" as const, justifyContent: "center" as const },
  legend: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.md },
  legendItem: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  zoomRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  zoomButton: {
    width: size.touchTargetMin,
    height: size.touchTargetMin,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  zoomValue: { minWidth: 44, textAlign: "center" as const },
  summary: { borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  summaryHeader: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: spacing.md },
  summaryCopy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.sm },
  seatChip: {
    maxWidth: "100%" as const,
    minHeight: size.touchTargetMin,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
  },
  shrink: { flexShrink: 1 },
};
