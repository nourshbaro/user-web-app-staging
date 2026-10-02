import { SkeletonBlock, SkeletonGroup } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { radius, spacing } from "@/lib/designTokens";
import { View } from "react-native";

/** Hero-shaped placeholder for the featured match. */
export function FeaturedMatchSkeleton() {
  return <SkeletonBlock height={236} borderRadius={radius.hero} />;
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

/** Outline of a v3 zone radio row (`ZoneRow`): 22pt ring, name + detail, price. */
function ZoneRowSkeleton({ first }: { first: boolean }) {
  const theme = useTheme();
  return (
    <View style={[local.zoneRow, !first && { borderTopWidth: 1, borderTopColor: theme.colors.hairline }]}>
      <SkeletonBlock width={22} height={22} borderRadius={11} />
      <View style={local.zoneCopy}>
        <SkeletonBlock width="45%" height={15} />
        <SkeletonBlock width="35%" height={12} />
      </View>
      <SkeletonBlock width={64} height={15} />
    </View>
  );
}

/**
 * One announced loading element for Match Details, in the final geometry:
 * the night hero, the "Choose where to sit" title with the Show map pill,
 * and the grouped zone list.
 */
export function MatchDetailSkeleton({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <SkeletonGroup label={label}>
      <SkeletonBlock height={236} borderRadius={radius.hero} />
      <View style={local.titleRow}>
        <View style={local.zoneCopy}>
          <SkeletonBlock width="60%" height={22} />
          <SkeletonBlock width="40%" height={12} />
        </View>
        <SkeletonBlock width={106} height={34} borderRadius={12} />
      </View>
      <View style={[local.group, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
        {[0, 1, 2].map((index) => (
          <ZoneRowSkeleton key={index} first={index === 0} />
        ))}
      </View>
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
      <View style={[local.group, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
        {Array.from({ length: count }, (_, index) => (
          <MatchRowSkeleton key={index} first={index === 0} />
        ))}
      </View>
    </SkeletonGroup>
  );
}

const local = {
  group: { borderRadius: radius.xl, overflow: "hidden" as const },
  rowItem: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md, padding: spacing.lg },
  rowTeams: { flex: 1, gap: spacing.sm },
  rowTeam: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  rowWhen: { alignItems: "flex-end" as const, gap: spacing.xs },
  titleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md, paddingTop: spacing.sm },
  zoneRow: { minHeight: 64, flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  zoneCopy: { flex: 1, gap: spacing.sm },
};
