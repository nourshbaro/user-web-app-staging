import { SkeletonBlock, SkeletonGroup } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { radius, spacing } from "@/lib/designTokens";
import { View, type DimensionValue } from "react-native";

/** Placeholder with the same outline as `MatchCard`, so content does not jump when data arrives. */
export function MatchCardSkeleton({ width = "100%" }: { width?: DimensionValue }) {
  const theme = useTheme();
  return (
    <View style={[local.card, { width, backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={local.row}>
        <SkeletonBlock width="40%" height={14} />
        <SkeletonBlock width={72} height={22} borderRadius={radius.pill} />
      </View>
      <View style={local.teams}>
        {[0, 1].map((side) => (
          <View key={side} style={local.team}>
            <SkeletonBlock width={44} height={44} borderRadius={22} />
            <SkeletonBlock width="70%" height={14} />
          </View>
        ))}
      </View>
      <SkeletonBlock width="55%" height={12} />
    </View>
  );
}

/** Hero-shaped placeholder for the featured match. */
export function FeaturedMatchSkeleton() {
  return <SkeletonBlock height={264} borderRadius={radius.lg} />;
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

/** One announced loading element for a whole match list (plus optional hero). */
export function MatchListSkeleton({
  label,
  count,
  columns,
  cardWidth,
  withFeatured = false,
}: {
  label: string;
  count: number;
  columns: number;
  cardWidth: DimensionValue;
  withFeatured?: boolean;
}) {
  return (
    <SkeletonGroup label={label}>
      {withFeatured ? <FeaturedMatchSkeleton /> : null}
      <View style={local.grid}>
        {Array.from({ length: Math.max(count, columns) }, (_, index) => (
          <MatchCardSkeleton key={index} width={cardWidth} />
        ))}
      </View>
    </SkeletonGroup>
  );
}

const local = {
  card: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.lg },
  row: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const },
  teams: { flexDirection: "row" as const, gap: spacing.lg },
  team: { flex: 1, alignItems: "center" as const, gap: spacing.sm },
  grid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.md },
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
