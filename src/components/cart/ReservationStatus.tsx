import { AppText } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { countdownParts, reservationUrgency, type ReservationUrgency } from "@/lib/cartPresentation";
import { spacing } from "@/lib/designTokens";
import { minutesSeconds } from "@/lib/format";
import { useEffect, useRef } from "react";
import { AccessibilityInfo, View } from "react-native";

const RANK: Record<ReservationUrgency, number> = { normal: 0, low: 1, critical: 2, expired: 3 };

/**
 * Screen-reader announcements when the reservation's urgency increases
 * (never once per second). `secondsLeft` is `CartContext.secondsLeft`.
 * Used by the Cart countdown card and by screens that rely on the global
 * read-only indicator for the visible countdown (holders, Checkout).
 */
export function useReservationAnnouncements(secondsLeft: number) {
  const i18n = useI18n();
  const urgency = reservationUrgency(secondsLeft);
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

  return urgency;
}

/**
 * v3 Cart countdown card: a 56pt ring with mm:ss and the hold explanation.
 * Presentation only: `secondsLeft` is the value `CartContext` computes from
 * the backend `expires_at`; this component never extends, resets or clears
 * the reservation. The backend sends no hold duration, so the ring is a
 * status ring (brand while time remains), not an invented progress fraction.
 */
export function ReservationStatus({ secondsLeft }: { secondsLeft: number }) {
  const theme = useTheme();
  const i18n = useI18n();
  const urgency = useReservationAnnouncements(secondsLeft);
  const { minutes, seconds } = countdownParts(secondsLeft);
  const danger = theme.colors.tones.danger;
  const note =
    urgency === "low"
      ? i18n.t("cart.reservation.low")
      : urgency === "critical"
        ? i18n.t("cart.reservation.critical")
        : null;
  const expired = urgency === "expired";

  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={
        expired
          ? i18n.t("cart.reservation.expired")
          : [i18n.t("cart.reservation.a11y", { minutes, seconds }), note].filter(Boolean).join(". ")
      }
      style={[local.card, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}
    >
      <View
        style={[
          local.ring,
          {
            borderColor: expired ? theme.colors.bgAlt : theme.colors.actionPrimary,
            backgroundColor: urgency === "normal" ? "transparent" : danger.bg,
          },
        ]}
      >
        <AppText variant="label" align="center" style={local.time}>
          {expired ? "0:00" : minutesSeconds(secondsLeft)}
        </AppText>
      </View>
      <View style={local.copy}>
        <AppText variant="bodyStrong" style={local.title}>
          {expired ? i18n.t("cart.reservation.expired") : i18n.t("cart.reservation.heldTitle")}
        </AppText>
        {/* Urgency is stated in words as well as colour. */}
        <AppText variant="meta" tone={note ? "danger" : "muted"} style={local.body}>
          {note ?? i18n.t("cart.reservation.explain")}
        </AppText>
      </View>
    </View>
  );
}

const local = {
  // v3: padding 14 16, radius 20, 56pt ring (stroke 4), mm:ss 13/700.
  card: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 14,
    borderRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  ring: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 4,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  time: { fontSize: 13, fontVariant: ["tabular-nums" as const] },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 16, lineHeight: 21 },
  body: { fontWeight: "400" as const },
};
