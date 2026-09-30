import { AppText } from "@/components/foundation";
import { useTheme } from "@/components/ui";
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

/** v3 seat silhouette: rounder back (top) than front, radius 7 7 5 5 at 22pt. */
function seatShape(seatSize: number): ViewStyle {
  const back = seatSize * 0.32;
  const front = seatSize * 0.23;
  return {
    borderTopLeftRadius: back,
    borderTopRightRadius: back,
    borderBottomLeftRadius: front,
    borderBottomRightRadius: front,
  };
}

/**
 * Seat marker appearance per state. Each state differs in shape or fill as
 * well as colour, so the map never relies on colour alone:
 * available = outlined seat, selected = filled brand seat with a centre mark,
 * in cart = rounded gold square, unavailable = hollow, faded outline.
 */
export function seatGlyphStyle(state: SeatVisualState, colors: ThemeColors, seatSize: number): ViewStyle {
  const box: ViewStyle = { width: seatSize, height: seatSize };
  const base: ViewStyle = { ...box, ...seatShape(seatSize), borderWidth: 1.5 };
  switch (state) {
    case "selected":
      return { ...base, backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary };
    case "inCart":
      // A plain rounded square (no seat silhouette corners, which would override it).
      return { ...box, borderRadius: seatSize * 0.22, backgroundColor: colors.gold, borderWidth: 2, borderColor: colors.surface };
    case "unavailable":
      return { ...base, backgroundColor: "transparent", borderColor: colors.disabledText, borderStyle: "dashed", opacity: 0.7 };
    default:
      return { ...base, backgroundColor: colors.surface, borderColor: colors.textMuted };
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
          <AppText variant="meta" tone="muted" style={local.legendText}>{item.label}</AppText>
        </View>
      ))}
    </View>
  );
}

/** v3 pitch marker above the seats: a green bar with a letter-spaced label. */
export function PitchBar() {
  const i18n = useI18n();
  return (
    <View
      style={local.pitch}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <AppText variant="caption" style={local.pitchText}>{i18n.t("seats.pitch")}</AppText>
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
      style={({ pressed }) => [local.zoomButton, pressed && enabled && { opacity: 0.6 }]}
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
    <View style={[local.zoomRow, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
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
 * v3 selected-seat chips for the seat picker's action bar: real seat labels
 * from the backend seat data. Each chip removes that seat from the draft.
 */
export function SelectedSeatChips({
  seats,
  unitPriceLabel,
  disabled,
  onRemove,
  onClear,
}: {
  seats: SummarySeat[];
  unitPriceLabel: string;
  disabled: boolean;
  onRemove: (seatId: number) => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  const i18n = useI18n();
  const brand = theme.colors.tones.brand;

  return (
    <View style={local.chipsBlock}>
      <View style={local.chipsHeader}>
        {seats.length ? (
          <Pressable
            onPress={onClear}
            disabled={disabled}
            accessibilityRole="button"
            aria-disabled={disabled}
            style={({ pressed }) => [local.clear, pressed && { opacity: 0.6 }]}
          >
            <AppText variant="meta" style={{ color: theme.colors.brandInk }}>{i18n.t("seats.summary.clear")}</AppText>
          </Pressable>
        ) : (
          <AppText variant="meta" tone="muted" style={local.hint}>{i18n.t("seats.tapHint")}</AppText>
        )}
        <AppText variant="meta" tone="muted">{i18n.t("seats.each", { price: unitPriceLabel })}</AppText>
      </View>
      {seats.length ? (
        <View style={local.chips}>
          {seats.map((seat) => (
            <Pressable
              key={seat.id}
              onPress={() => onRemove(seat.id)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={i18n.t("seats.summary.remove", { seat: seat.label })}
              aria-disabled={disabled}
              hitSlop={{ top: 8, bottom: 8 }}
              style={({ pressed }) => [local.seatChip, { backgroundColor: brand.bg }, pressed && { opacity: 0.7 }]}
            >
              <AppText variant="meta" numberOfLines={1} style={[local.shrink, { color: theme.colors.brandInk, fontWeight: "600" }]}>
                {seat.label}
              </AppText>
              <SymbolView
                name={{ ios: "xmark", android: "close", web: "close" }}
                size={12}
                tintColor={theme.colors.brandInk}
                fallback={<View />}
              />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const local = {
  centered: { alignItems: "center" as const, justifyContent: "center" as const },
  legend: { flexDirection: "row" as const, flexWrap: "wrap" as const, columnGap: spacing.lg, rowGap: spacing.sm },
  legendItem: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  legendText: { fontWeight: "400" as const },
  // v3: 28pt bar, radius 10, pitch green, 11/600 letter-spaced label.
  pitch: {
    height: 28,
    borderRadius: 10,
    backgroundColor: "#3F8E5A",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  pitchText: { color: "#FFFFFF", fontSize: 11, fontWeight: "600" as const, letterSpacing: 1.6, textTransform: "uppercase" as const },
  zoomRow: { flexDirection: "row" as const, alignItems: "center" as const, borderRadius: 12, alignSelf: "flex-start" as const },
  zoomButton: {
    width: size.touchTargetMin,
    height: size.touchTargetMin,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  zoomValue: { minWidth: 44, textAlign: "center" as const },
  chipsBlock: { gap: spacing.sm },
  chipsHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: spacing.md,
  },
  hint: { flexShrink: 1 },
  clear: { minHeight: 32, justifyContent: "center" as const },
  chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
  // v3: 28pt chip, radius 8, brand-soft fill, brand-ink 13/600.
  seatChip: {
    maxWidth: "100%" as const,
    minHeight: 28,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
  },
  shrink: { flexShrink: 1 },
};
