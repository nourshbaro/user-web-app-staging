import { AppText, SectionHeader } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { holderCompleteness, isHolderNameValid } from "@/lib/checkoutFlow";
import { radius, size, spacing } from "@/lib/designTokens";
import type { TicketSlot } from "@/lib/ticketHolders";
import { router } from "expo-router";
import { Pressable, View } from "react-native";

/** Rows shown before "Show all" on long carts. */
const PREVIEW_COUNT = 3;

/**
 * Ticket-holder summary on Checkout. Edit opens the same ticket-holder step
 * (`/checkout/ticket-holders?edit=1`) rather than a second editing UI.
 *
 * Every control is a sibling, never nested inside another button: the Edit
 * action is the section header's own action, and the show-all toggle is a
 * separate button with `aria-expanded`. Names come from `TicketHoldersContext`.
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
  const i18n = useI18n();
  const completeness = holderCompleteness(ticketSlots, holderNames);
  const collapsible = ticketSlots.length > PREVIEW_COUNT;
  const visible = collapsible && !expanded ? ticketSlots.slice(0, PREVIEW_COUNT) : ticketSlots;

  return (
    <View style={[local.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <SectionHeader
        title={i18n.t("checkout.holders.title")}
        subtitle={i18n.t("holders.progress", { complete: completeness.complete, total: completeness.total })}
        action={{
          label: i18n.t("checkout.holders.edit"),
          onPress: () => router.navigate("/checkout/ticket-holders?edit=1"),
          accessibilityHint: i18n.t("checkout.holders.editHint"),
        }}
      />
      <View style={local.list}>
        {visible.map((slot) => {
          const name = holderNames[slot.key]?.trim();
          const valid = isHolderNameValid(name);
          return (
            <View key={slot.key} style={local.row} accessible accessibilityLabel={`${slot.label}: ${valid ? name : i18n.t("checkout.holders.notSet")}`}>
              <AppText variant="caption" tone="muted" numberOfLines={1} style={local.slot}>{slot.label}</AppText>
              <AppText variant="bodyStrong" tone={valid ? "strong" : "danger"} numberOfLines={1} style={local.name}>
                {valid ? name : i18n.t("checkout.holders.notSet")}
              </AppText>
            </View>
          );
        })}
      </View>
      {collapsible ? (
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          aria-expanded={expanded}
          style={({ pressed }) => [local.toggle, pressed && { opacity: 0.7 }]}
        >
          <AppText variant="label" tone="brand">
            {expanded ? i18n.t("checkout.holders.showLess") : i18n.t("checkout.holders.showAll", { count: ticketSlots.length })}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const local = {
  card: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
  list: { gap: spacing.sm },
  row: { gap: spacing.xxs },
  slot: {},
  name: {},
  toggle: { minHeight: size.touchTargetMin, justifyContent: "center" as const, alignSelf: "flex-start" as const },
};
