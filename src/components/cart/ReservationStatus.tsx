import { AppText } from "@/components/foundation";
import { CartTimer } from "@/components/CartTimer";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { countdownParts, reservationUrgency, type ReservationUrgency } from "@/lib/cartPresentation";
import { radius, spacing } from "@/lib/designTokens";
import type { StatusTone } from "@/lib/themePalette";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef } from "react";
import { AccessibilityInfo, View } from "react-native";

const TONE: Record<ReservationUrgency, StatusTone> = {
  normal: "info",
  low: "warning",
  critical: "danger",
  expired: "danger",
};

const RANK: Record<ReservationUrgency, number> = { normal: 0, low: 1, critical: 2, expired: 3 };

/**
 * Reservation countdown banner. Presentation only: `secondsLeft` is the
 * value `CartContext` computes from the backend `expires_at`; this component
 * never extends, resets or clears the reservation. Screen readers hear the
 * current value on focus and an announcement only when urgency increases,
 * never once per second.
 */
export function ReservationStatus({ secondsLeft }: { secondsLeft: number }) {
  const theme = useTheme();
  const i18n = useI18n();
  const urgency = reservationUrgency(secondsLeft);
  const tone = theme.colors.tones[TONE[urgency]];
  const { minutes, seconds } = countdownParts(secondsLeft);
  const announcedRef = useRef<ReservationUrgency>(urgency);

  useEffect(() => {
    const previous = announcedRef.current;
    announcedRef.current = urgency;
    if (RANK[urgency] <= RANK[previous]) return;
    const key =
      urgency === "expired"
        ? "cart.reservation.announce.expired"
        : urgency === "critical"
          ? "cart.reservation.announce.critical"
          : "cart.reservation.announce.low";
    AccessibilityInfo.announceForAccessibility(i18n.t(key));
  }, [i18n, urgency]);

  const note =
    urgency === "low"
      ? i18n.t("cart.reservation.low")
      : urgency === "critical"
        ? i18n.t("cart.reservation.critical")
        : null;

  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={
        urgency === "expired"
          ? i18n.t("cart.reservation.expired")
          : [i18n.t("cart.reservation.a11y", { minutes, seconds }), note].filter(Boolean).join(". ")
      }
      style={[local.banner, { backgroundColor: tone.bg, borderColor: tone.border }]}
    >
      <SymbolView
        name={{ ios: "timer", android: "timer", web: "timer" } as never}
        size={20}
        tintColor={tone.fg}
        fallback={<View />}
      />
      <View style={local.copy}>
        {urgency === "expired" ? (
          <AppText variant="bodyStrong" style={{ color: tone.fg }}>{i18n.t("cart.reservation.expired")}</AppText>
        ) : (
          <>
            <AppText variant="label" style={{ color: tone.fg }}>{i18n.t("cart.reservation.held")}</AppText>
            {note ? <AppText variant="caption" style={{ color: tone.fg }}>{note}</AppText> : null}
          </>
        )}
      </View>
      {urgency === "expired" ? null : (
        <CartTimer seconds={secondsLeft} style={[local.time, { color: tone.fg }]} />
      )}
    </View>
  );
}

const local = {
  banner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  time: { fontSize: 22, lineHeight: 28 },
};
