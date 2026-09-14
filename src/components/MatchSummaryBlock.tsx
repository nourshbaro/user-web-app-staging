import { Card, useTheme, type ThemeColors } from "@/components/ui";
import type { CartDisplayItem } from "@/lib/cartDisplay";
import { formatMoney } from "@/lib/format";
import { Text, View } from "react-native";

/**
 * One order-summary block per match represented in the cart (Checkout
 * shows one of these per distinct match, in stable cart order).
 *
 * Team crests aren't part of the cart API response (only `match_title` is —
 * see services/cart.ts), so this intentionally reuses the same "no image"
 * initials-badge convention already used by TeamLogo on the Match Details
 * screen rather than re-fetching full match details just for a logo, or
 * inventing artwork that isn't there.
 */
export function MatchSummaryBlock({
  matchTitle,
  items,
}: {
  matchTitle: string;
  items: CartDisplayItem[];
}) {
  const theme = useTheme();
  const local = createStyles(theme.colors);
  const [homeName, awayName] = splitMatchTitle(matchTitle);
  const currency = items[0]?.currency ?? "USD";

  return (
    <Card>
      <View style={local.header}>
        {/* <View style={local.crests}>
          <TeamBadge name={homeName} />
          <View style={[local.versus, { backgroundColor: theme.colors.panelSoft }]}>
            <Text style={[local.versusText, { color: theme.colors.muted }]}>VS</Text>
          </View>
          <TeamBadge name={awayName} />
        </View> */}
        <View style={local.headerCopy}>
          <Text
            numberOfLines={2}
            style={[local.title, { color: theme.colors.ink }]}
          >
            {matchTitle}
          </Text>
        </View>
      </View>

      <View style={[local.separator, { backgroundColor: theme.colors.line }]} />

      <View style={local.tickets}>
        {items.map((item) => (
          <View key={item.key} style={local.ticketRow}>
            <Text
              numberOfLines={1}
              style={[local.ticketLabel, { color: theme.colors.ink }]}
            >
              {item.quantity} x {item.zone_name ?? "Ticket"}
            </Text>
            <Text style={[local.ticketPrice, { color: theme.colors.ink }]}>
              {formatMoney(item.subtotal, item.currency)}
            </Text>
          </View>
        ))}
      </View>

      <View
        style={[local.matchTotalRow, { borderTopColor: theme.colors.line }]}
      >
        <Text style={theme.styles.muted}>Match subtotal</Text>
        <Text style={[local.matchTotal, { color: theme.colors.ink }]}>
          {formatMoney(
            items.reduce((sum, item) => sum + Number(item.subtotal ?? 0), 0),
            currency,
          )}
        </Text>
      </View>
    </Card>
  );
}

function splitMatchTitle(matchTitle: string): [string, string] {
  const parts = matchTitle.split(/\s+vs\.?\s+/i);
  if (parts.length === 2) return [parts[0].trim(), parts[1].trim()];
  return [matchTitle, ""];
}

function TeamBadge({ name }: { name: string }) {
  const theme = useTheme();
  const local = createStyles(theme.colors);
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("") || "LFA";

  return (
    <View
      style={[
        local.badge,
        {
          backgroundColor: theme.colors.panelSoft,
          borderColor: theme.colors.line,
        },
      ]}
    >
      <Text style={[local.badgeText, { color: theme.colors.primary }]}>
        {initials}
      </Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return {
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
    },
    crests: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
    },
    badge: {
      width: 36,
      height: 36,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    badgeText: { fontSize: 11, fontWeight: "900" as const },
    versus: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    versusText: { fontSize: 8, fontWeight: "900" as const },
    headerCopy: { flex: 1, minWidth: 0 },
    title: { fontSize: 15, fontWeight: "900" as const, lineHeight: 20 },
    separator: { height: 1, marginVertical: 2 },
    tickets: { gap: 8 },
    ticketRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
    },
    ticketLabel: {
      flex: 1,
      minWidth: 0,
      fontSize: 14,
      fontWeight: "700" as const,
    },
    ticketPrice: { fontSize: 14, fontWeight: "900" as const, flexShrink: 0 },
    matchTotalRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      borderTopWidth: 1,
      paddingTop: 10,
      marginTop: 2,
    },
    matchTotal: { fontSize: 14, fontWeight: "900" as const },
  };
}
