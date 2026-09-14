import { SymbolView } from "expo-symbols";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Card, useTheme } from "@/components/ui";
import { Collapsible } from "@/components/Collapsible";
import type { TicketSlot } from "@/lib/ticketHolders";

/**
 * Collapsible "Ticket Holders" summary on Checkout. Tapping the pen icon
 * opens the same step-by-step ticket-holder flow used before Checkout
 * (`/checkout/ticket-holders?edit=1`) rather than a second editing UI.
 */
export function TicketHoldersBlock({
  ticketSlots,
  holderNames,
  expanded,
  onToggle,
}: {
  ticketSlots: TicketSlot[];
  holderNames: Record<string, string>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();

  return (
    <Card>
      <Collapsible
        title="Ticket Holders"
        expanded={expanded}
        onToggle={onToggle}
        headerRight={
          <Pressable
            onPress={() => router.navigate("/checkout/ticket-holders?edit=1")}
            accessibilityRole="button"
            accessibilityLabel="Edit ticket holders"
            hitSlop={10}
            style={local.editButton}
          >
            <SymbolView
              name={{ ios: "pencil", android: "edit", web: "edit" }}
              size={16}
              tintColor={theme.colors.primary}
              fallback={<Text style={{ color: theme.colors.primary, fontWeight: "900" }}>✎</Text>}
            />
          </Pressable>
        }
      >
        <View style={local.list}>
          {ticketSlots.map((slot, index) => (
            <Text key={slot.key} numberOfLines={1} style={[local.name, { color: theme.colors.ink }]}>
              #{index + 1} {holderNames[slot.key]?.trim() || "Not set"}
            </Text>
          ))}
        </View>
      </Collapsible>
    </Card>
  );
}

const local = {
  editButton: {
    width: 32,
    height: 32,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  list: { gap: 6 },
  name: { fontSize: 14, fontWeight: "700" as const },
};
