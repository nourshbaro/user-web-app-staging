import { AppText, NavigationBackGlyph } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { size, spacing } from "@/lib/designTokens";
import { flowHeaderLayout, headerPlatform } from "@/lib/flowHeaderPresentation";
import type { ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";

/**
 * v3 pushed-screen header (subpages and transactional flows): a 48pt bar with
 * a back action and the screen title, drawn per platform
 * (`flowHeaderLayout`): iOS — red chevron, previous-screen label, centred
 * title; Android — ink arrow, start-aligned display title. Presentation only:
 * the screen owns what Back does (and whether it is currently allowed).
 */
export function FlowHeader({
  title,
  subtitle,
  backLabel,
  onBack,
  backDisabled = false,
  titleOnIos = true,
  androidTitle = "display",
  trailing,
}: {
  title: string;
  subtitle?: string;
  /** Short name of the previous screen, shown beside the chevron on iOS (v3 "Profile", "Cart"…). */
  backLabel?: string;
  onBack: () => void;
  backDisabled?: boolean;
  /** false where v3 shows no header title on iOS (the in-page heading is the title). */
  titleOnIos?: boolean;
  /** Android title style: v3 display title, or "plain" (20pt title over a detail line, v3 `seats`). */
  androidTitle?: "display" | "plain";
  /** End-aligned detail on both platforms (v3 ticket "1 of 3"). */
  trailing?: ReactNode;
}) {
  const theme = useTheme();
  const i18n = useI18n();
  const platform = headerPlatform(Platform.OS);
  const layout = flowHeaderLayout(platform, { title, subtitle, backLabel, titleOnIos, androidTitle });
  const tint = layout.backTone === "brand" ? theme.colors.brandInk : theme.colors.textStrong;

  const back = (
    <Pressable
      onPress={() => {
        if (!backDisabled) onBack();
      }}
      disabled={backDisabled}
      accessibilityRole="button"
      accessibilityLabel={backLabel ? i18n.t("flow.backTo", { step: backLabel }) : i18n.t("common.back")}
      aria-disabled={backDisabled}
      hitSlop={4}
      style={({ pressed }) => [local.back, (pressed || backDisabled) && { opacity: backDisabled ? 0.4 : 0.6 }]}
    >
      <NavigationBackGlyph size={layout.backGlyph === "chevron" ? 20 : 24} color={tint} />
      {layout.backLabel ? (
        <AppText variant="bodyStrong" numberOfLines={1} style={{ color: tint, fontWeight: "400", fontSize: 17 }}>
          {layout.backLabel}
        </AppText>
      ) : null}
    </Pressable>
  );

  if (layout.title?.placement === "start") {
    // Android: the title sits beside the arrow (v3 margin-left 6).
    const display = layout.title.style === "display";
    return (
      <View style={local.header}>
        {back}
        <View style={local.startTitle}>
          <AppText
            variant={display ? "displaySection" : "body"}
            numberOfLines={1}
            accessibilityRole="header"
            style={display ? local.displayTitle : local.plainLargeTitle}
          >
            {layout.title.text}
          </AppText>
          {layout.subtitle ? (
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {layout.subtitle}
            </AppText>
          ) : null}
        </View>
        {trailing ?? null}
      </View>
    );
  }

  return (
    <View style={local.header}>
      {back}
      {layout.title ? (
        <View style={local.center} pointerEvents="none">
          <AppText variant="bodyStrong" align="center" numberOfLines={1} accessibilityRole="header" style={local.title}>
            {layout.title.text}
          </AppText>
          {layout.subtitle ? (
            <AppText variant="caption" tone="muted" align="center" numberOfLines={1}>
              {layout.subtitle}
            </AppText>
          ) : null}
        </View>
      ) : null}
      <View style={local.end} />
      {trailing ?? null}
    </View>
  );
}

/** v3 two-step progress (Holders → Payment): 4pt segments, done steps in brand red. */
export function StepBar({ step, total = 2 }: { step: number; total?: number }) {
  const theme = useTheme();
  const i18n = useI18n();
  return (
    <View
      style={local.steps}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={i18n.t("flow.step", { step, total })}
      accessibilityValue={{ min: 1, max: total, now: step }}
    >
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          style={[local.segment, { backgroundColor: index < step ? theme.colors.actionPrimary : theme.colors.bgAlt }]}
        />
      ))}
    </View>
  );
}

const local = {
  header: {
    minHeight: size.touchTarget,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
  },
  back: {
    minHeight: size.touchTargetMin,
    minWidth: size.touchTargetMin,
    maxWidth: "30%" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 2,
    zIndex: 1,
  },
  center: { position: "absolute" as const, left: 96, right: 96, alignItems: "center" as const },
  title: { fontSize: 17, lineHeight: 22 },
  // v3 Android: the title starts 44pt after the arrow's start (glyph at the
  // button's 6pt padding, title margin-left 6 after the 44pt button), i.e.
  // right at the end of our 44pt back target.
  startTitle: { flex: 1, minWidth: 0, marginStart: -spacing.sm },
  // v3 Android: Barlow Condensed 700 26/1 uppercase, .01em.
  displayTitle: { fontSize: 26, lineHeight: 28, letterSpacing: 0.26 },
  // v3 Android seats: 20/1.2 regular.
  plainLargeTitle: { fontSize: 20, lineHeight: 24, fontWeight: "400" as const },
  end: { flex: 1 },
  steps: { flexDirection: "row" as const, gap: 6 },
  segment: { flex: 1, height: 4, borderRadius: 2 },
};
