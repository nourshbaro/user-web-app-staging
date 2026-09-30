import { AppText, SectionHeader } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import type { CartDisplayItem } from "@/lib/cartDisplay";
import { groupLinesByMatch, groupSubtotal } from "@/lib/cartPresentation";
import { radius, spacing } from "@/lib/designTokens";
import { formatMoney } from "@/lib/format";
import { View } from "react-native";

/**
 * Checkout order summary grouped by match. Presentation only: line values
 * come from the cart owner. A per-match subtotal is display-only and omitted
 * when it cannot be computed honestly; the order total is always the owner's
 * `cart.total`, passed in already formatted.
 */
export function OrderSummary({ lines, totalLabel }: { lines: CartDisplayItem[]; totalLabel: string }) {
  const theme = useTheme();
  const i18n = useI18n();
  const groups = groupLinesByMatch(lines);

  return (
    <View style={[local.card, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
      <SectionHeader title={i18n.t("checkout.summary.title")} />
      {groups.map((group) => {
        const subtotal = group.lines.length > 1 ? groupSubtotal(group.lines) : null;
        return (
          <View key={group.matchId} style={[local.group, { borderTopColor: theme.colors.hairline }]}>
            <AppText variant="bodyStrong" numberOfLines={2}>
              {group.matchTitle ?? i18n.t("cart.matchFallback", { id: group.matchId })}
            </AppText>
            {group.lines.map((line) => {
              const seats = line.seats.map((seat) => seat.label ?? `${seat.row}${seat.number}`);
              return (
                <View key={line.key} style={local.row}>
                  <View style={local.rowCopy}>
                    <AppText variant="body" numberOfLines={2}>
                      {i18n.t("checkout.summary.line", {
                        quantity: line.quantity,
                        zone: line.zone_name ?? i18n.t("cart.zoneFallback"),
                      })}
                    </AppText>
                    {seats.length ? (
                      <AppText variant="caption" tone="muted">{i18n.t("cart.line.seats", { seats: seats.join(", ") })}</AppText>
                    ) : null}
                  </View>
                  <AppText variant="bodyStrong" style={local.amount}>{formatMoney(line.subtotal, line.currency)}</AppText>
                </View>
              );
            })}
            {subtotal ? (
              <View style={local.row}>
                <AppText variant="meta" tone="muted" style={local.rowCopy}>{i18n.t("checkout.summary.matchSubtotal")}</AppText>
                <AppText variant="meta" tone="muted" style={local.amount}>{formatMoney(subtotal.amount, subtotal.currency)}</AppText>
              </View>
            ) : null}
          </View>
        );
      })}
      <View style={[local.totalRow, { borderTopColor: theme.colors.hairline }]} accessible accessibilityLabel={`${i18n.t("checkout.total")}, ${totalLabel}`}>
        <AppText variant="bodyStrong" style={local.totalTitle}>{i18n.t("checkout.total")}</AppText>
        <AppText variant="displayNumeral" style={local.totalValue}>{totalLabel}</AppText>
      </View>
    </View>
  );
}

const local = {
  card: { borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md },
  group: { gap: spacing.sm, borderTopWidth: 1, paddingTop: spacing.md },
  row: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: spacing.md },
  rowCopy: { flex: 1, minWidth: 0 },
  amount: { flexShrink: 0 },
  totalRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: spacing.md,
    borderTopWidth: 1,
    paddingTop: spacing.md,
  },
  totalTitle: { fontSize: 16, lineHeight: 21 },
  // v3 checkout total: 25pt display numerals.
  totalValue: { fontSize: 25, lineHeight: 30, flexShrink: 1 },
};
