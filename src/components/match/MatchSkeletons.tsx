import { SkeletonBlock, SkeletonGroup } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { radius, spacing } from "@/lib/designTokens";
import { View } from "react-native";

/** Hero-shaped placeholder for the featured match. */
export function FeaturedMatchSkeleton() {
  return <SkeletonBlock height={236} borderRadius={radius.xxl} />;
}

/** Placeholder with the outline of a `MatchCard` row inside a grouped card. */
function MatchRowSkeleton({ first }: { first: boolean }) {
  const theme = useTheme();
  return (
    <View style={[local.rowItem, !first && { borderTopWidth: 1, borderTopColor: theme.colors.hairline }]}>
      <View style={local.rowTeams}>
        {[0, 1].map((side) => (
          <View key={side} style={local.rowTeam}>
            <SkeletonBlock width={26} height={26} borderRadius={13} />
            <SkeletonBlock width="55%" height={14} />
          </View>
        ))}
      </View>
      <View style={local.rowWhen}>
        <SkeletonBlock width={56} height={14} />
        <SkeletonBlock width={64} height={12} />
      </View>
    </View>
  );
}

/** Placeholder with the outline of a Match Details ticket option row. */
export function TicketOptionSkeleton() {
  const theme = useTheme();
  return (
    <View style={[local.option, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={local.optionCopy}>
        <SkeletonBlock width="55%" height={16} />
        <SkeletonBlock width="35%" height={12} />
      </View>
      <SkeletonBlock width={112} height={40} borderRadius={radius.md} />
    </View>
  );
}

/** One announced loading element for Match Details: hero plus ticket options. */
export function MatchDetailSkeleton({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label}>
      <SkeletonBlock height={236} borderRadius={radius.lg} />
      <SkeletonBlock width="40%" height={20} />
      {[0, 1, 2].map((index) => (
        <TicketOptionSkeleton key={index} />
      ))}
    </SkeletonGroup>
  );
}

/** One announced loading element for a whole match list (plus optional hero), shaped like the grouped rows. */
export function MatchListSkeleton({
  label,
  count,
  withFeatured = false,
}: {
  label: string;
  count: number;
  withFeatured?: boolean;
}) {
  const theme = useTheme();
  return (
    <SkeletonGroup label={label}>
      {withFeatured ? <FeaturedMatchSkeleton /> : null}
      <SkeletonBlock width="35%" height={14} />
      <View style={[local.group, { backgroundColor: theme.colors.surface, borderColor: theme.colors.hairline }]}>
        {Array.from({ length: count }, (_, index) => (
          <MatchRowSkeleton key={index} first={index === 0} />
        ))}
      </View>
    </SkeletonGroup>
  );
}

const local = {
  group: { borderRadius: radius.xl, borderWidth: 1, overflow: "hidden" as const },
  rowItem: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md, padding: spacing.lg },
  rowTeams: { flex: 1, gap: spacing.sm },
  rowTeam: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  rowWhen: { alignItems: "flex-end" as const, gap: spacing.xs },
  option: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  optionCopy: { flex: 1, gap: spacing.sm },
};
