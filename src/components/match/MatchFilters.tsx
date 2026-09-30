import { BottomSheetModal } from "@/components/BottomSheetModal";
import { AppText, DirectionalChevron } from "@/components/foundation";
import { LiveDot } from "@/components/match/LiveBadge";
import { dateChipStyle, filterChipStyle } from "@/components/match/filterChipStyle";
import { Button, useTheme } from "@/components/ui";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages/en";
import { radius, size, spacing } from "@/lib/designTokens";
import { fontStyleFor } from "@/lib/fontFamilies";
import { formatAccessibleCalendarDate, formatCalendarDate, formatDayOfMonth, formatMonthYear, formatWeekdayShort, parseCalendarDate } from "@/lib/format";
import { getDateTriggerLabel, isDropdownOptionSelected } from "@/lib/matchFilterAccessibility";
import {
  activeFilterCount,
  addMonths,
  dateStripForTab,
  getCalendarDays,
  isBeforeDay,
  isSameDay,
  MATCH_TABS,
  startOfMonth,
  startOfToday,
  toDateInputValue,
  type MatchTab,
} from "@/lib/matchDiscovery";
import type { FilterOption, MatchFilters } from "@/types";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { Animated, Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";

type FilterOptions = { teams: FilterOption[]; stadiums: FilterOption[] };

const TAB_LABELS: Record<MatchTab, MessageKey> = {
  upcoming: "matches.tab.upcoming",
  live: "matches.tab.live",
  results: "matches.tab.results",
};

/**
 * v3 Upcoming / Live / Results segmented control. Each segment selects the
 * backend query owned by the Matches screen; this control holds no data. The
 * Live dot appears only when the backend reports live matches.
 */
export function MatchTabs({ value, liveAvailable, onChange }: { value: MatchTab; liveAvailable: boolean; onChange: (tab: MatchTab) => void }) {
  const theme = useTheme();
  const { t, meta, isRTL } = useI18n();
  const reducedMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = MATCH_TABS.indexOf(value);
  const [thumb] = useState(() => new Animated.Value(index));

  useEffect(() => {
    if (reducedMotion) {
      thumb.setValue(index);
      return;
    }
    // v3: the thumb slides with a slight overshoot.
    Animated.spring(thumb, { toValue: index, useNativeDriver: true, speed: 16, bounciness: 6 }).start();
  }, [index, reducedMotion, thumb]);

  const segment = width > 0 ? (width - 8) / MATCH_TABS.length : 0;

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={t("matches.tabs.a11y")}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      style={[local.tabs, { backgroundColor: theme.colors.segment }]}
    >
      {segment > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            local.thumb,
            {
              width: segment,
              backgroundColor: theme.colors.surface,
              // The segment row mirrors in RTL, so the thumb travels the other way.
              transform: [{ translateX: thumb.interpolate({ inputRange: [0, 1], outputRange: [0, isRTL ? -segment : segment] }) }],
            },
          ]}
        />
      ) : null}
      {MATCH_TABS.map((tab) => {
        const selected = tab === value;
        const showLive = tab === "live" && liveAvailable;
        return (
          <Pressable
            key={tab}
            onPress={() => {
              if (!selected) onChange(tab);
            }}
            accessibilityRole="tab"
            accessibilityLabel={showLive ? t("matches.tab.liveNow") : t(TAB_LABELS[tab])}
            aria-selected={selected}
            style={local.tab}
          >
            {showLive ? <LiveDot /> : null}
            <Text
              numberOfLines={1}
              style={[
                local.tabText,
                fontStyleFor("text", selected ? "600" : "500", meta.script),
                { color: selected ? theme.colors.textStrong : theme.colors.textMuted },
              ]}
            >
              {t(TAB_LABELS[tab])}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * v3 date chips: "All" plus one chip per day. Every chip maps to the existing
 * backend `date` filter (one calendar day) or clears it; nothing is filtered on
 * the device. The dot marks days the backend returned fixtures for.
 */
export function MatchDateStrip({
  tab,
  value,
  datesWithFixtures,
  onSelect,
}: {
  tab: MatchTab;
  value?: string;
  /** Days with fixtures in the current tab's results (real data only). */
  datesWithFixtures: ReadonlySet<string>;
  onSelect: (date?: string) => void;
}) {
  const { t } = useI18n();
  const days = dateStripForTab(tab, startOfToday(), value);
  if (!days.length) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={local.strip} accessibilityLabel={t("filters.date")}>
      <DateChip selected={!value} label={t("filters.allDates")} accessibilityLabel={t("filters.anyDate")} wide onPress={() => onSelect(undefined)} />
      {days.map((day) => {
        const date = parseCalendarDate(day);
        if (!date) return null;
        return (
          <DateChip
            key={day}
            selected={value === day}
            weekday={formatWeekdayShort(date)}
            label={formatDayOfMonth(date)}
            hasFixtures={datesWithFixtures.has(day)}
            accessibilityLabel={formatAccessibleCalendarDate(date)}
            onPress={() => onSelect(day)}
          />
        );
      })}
    </ScrollView>
  );
}

function DateChip({
  selected,
  weekday,
  label,
  hasFixtures = false,
  wide = false,
  accessibilityLabel,
  onPress,
}: {
  selected: boolean;
  weekday?: string;
  label: string;
  hasFixtures?: boolean;
  wide?: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const fg = selected ? theme.colors.background : theme.colors.textStrong;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      aria-selected={selected}
      style={({ pressed }) => [
        local.dateChip,
        wide && local.dateChipWide,
        // v3: selected = filled ink chip (not colour alone); unselected cards carry `--shadow`.
        dateChipStyle({ selected, pressed, colors: theme.colors }),
      ]}
    >
      {weekday ? (
        <AppText variant="caption" numberOfLines={1} style={[local.weekday, { color: fg }]}>{weekday}</AppText>
      ) : null}
      <AppText variant={weekday ? "displayNumeral" : "label"} numberOfLines={1} style={{ color: fg }}>{label}</AppText>
      {weekday ? (
        <View style={[local.fixtureDot, { backgroundColor: hasFixtures ? (selected ? theme.colors.background : theme.colors.actionPrimary) : "transparent" }]} />
      ) : null}
    </Pressable>
  );
}

/**
 * v3 summary row: result summary, Clear, and the Filters entry. Applied
 * filter values are owned by the Matches screen; this bar only reports intent.
 */
export function MatchFilterBar({
  filters,
  sheetOpen,
  summary,
  onOpen,
  onClear,
}: {
  filters: MatchFilters;
  sheetOpen: boolean;
  /** Result summary owned by the screen (e.g. "12 matches · Nejmeh"); omitted while loading. */
  summary?: string;
  onOpen: () => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  const { t, plural } = useI18n();
  const count = activeFilterCount(filters);

  return (
    <View style={local.row}>
      {summary ? (
        <AppText variant="meta" tone="muted" numberOfLines={1} style={local.summary}>{summary}</AppText>
      ) : (
        <View style={local.summary} />
      )}

      {count ? (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel={t("filters.clear")}
          hitSlop={8}
          style={({ pressed }) => [local.clearLink, pressed && { opacity: 0.7 }]}
        >
          <AppText variant="meta" style={{ color: theme.colors.brandInk }}>{t("filters.clearShort")}</AppText>
        </Pressable>
      ) : null}

      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={count ? plural("filters.openActive", count) : t("filters.open")}
        aria-expanded={sheetOpen}
        hitSlop={5}
        style={({ pressed }) => [
          local.filterButton,
          {
            // Active filters invert the button (fill and count), not colour alone.
            backgroundColor: count ? theme.colors.textStrong : theme.colors.surface,
            boxShadow: theme.colors.shadowCard,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <SymbolView
          accessible={false}
          name={{ ios: "slider.horizontal.3", android: "tune", web: "tune" } as never}
          size={15}
          tintColor={count ? theme.colors.background : theme.colors.textStrong}
          fallback={<View />}
        />
        <AppText variant="meta" style={{ color: count ? theme.colors.background : theme.colors.textStrong }}>
          {count ? t("filters.openCount", { count }) : t("filters.open")}
        </AppText>
      </Pressable>
    </View>
  );
}

export type MatchFilterSelection = { filters: MatchFilters; tab: MatchTab };

/**
 * v3 filter sheet. It edits a draft (presentation state) initialised from the
 * applied selection each time it opens; "Show matches" hands the draft to the
 * Matches screen, which owns the applied values and the request. Reset
 * restores the defaults in the draft. Supported filters only: date (one
 * calendar day, the backend `date` parameter), status (the tab), team and
 * stadium. There is no competition filter: `/matches/scheduled` has none.
 */
export function MatchFiltersSheet({
  visible,
  value,
  options,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: MatchFilterSelection;
  options: FilterOptions;
  onApply: (next: MatchFilterSelection) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<MatchFilterSelection>(value);
  const [pickingDate, setPickingDate] = useState(() => Boolean(value.filters.date && value.filters.date !== toDateInputValue(startOfToday())));
  const today = toDateInputValue(startOfToday());
  const setFilters = (next: Partial<MatchFilters>) => setDraft((current) => ({ ...current, filters: { ...current.filters, ...next } }));

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      title={t("filters.sheetTitle")}
      titleVariant="display"
      headerAction={{
        label: t("filters.reset"),
        onPress: () => {
          setPickingDate(false);
          setDraft({ filters: {}, tab: "upcoming" });
        },
      }}
      footer={<Button title={t("filters.apply")} onPress={() => onApply(draft)} />}
      scrollable
      wide
    >
      <View style={local.sheetBody}>
        <View style={local.group} accessibilityRole="radiogroup" accessibilityLabel={t("filters.dateSection")}>
          <SectionTitle>{t("filters.dateSection")}</SectionTitle>
          <View style={local.options}>
            <OptionPill
              label={t("filters.anyDate")}
              selected={!draft.filters.date && !pickingDate}
              onPress={() => {
                setPickingDate(false);
                setFilters({ date: undefined });
              }}
            />
            <OptionPill
              label={t("filters.today")}
              selected={draft.filters.date === today && !pickingDate}
              onPress={() => {
                setPickingDate(false);
                setFilters({ date: today });
              }}
            />
            <OptionPill
              label={draft.filters.date && pickingDate ? formatCalendarDate(draft.filters.date) : t("filters.pickDate")}
              selected={pickingDate}
              onPress={() => setPickingDate(true)}
            />
          </View>
          {pickingDate ? (
            // Upcoming starts today; Live and Results may be any day.
            <DateFilter value={draft.filters.date} allowPast={draft.tab !== "upcoming"} onSelect={(date) => setFilters({ date })} />
          ) : null}
        </View>

        <View style={local.group} accessibilityRole="radiogroup" accessibilityLabel={t("filters.statusSection")}>
          <SectionTitle>{t("filters.statusSection")}</SectionTitle>
          <View style={local.options}>
            {MATCH_TABS.map((tab) => (
              <OptionPill key={tab} label={t(TAB_LABELS[tab])} selected={draft.tab === tab} onPress={() => setDraft((current) => ({ ...current, tab }))} />
            ))}
          </View>
        </View>

        <OptionGroup
          label={t("filters.team")}
          allLabel={t("filters.allTeams")}
          options={options.teams}
          selected={draft.filters.team}
          onSelect={(team) => setFilters({ team })}
        />
        <OptionGroup
          label={t("filters.stadiumSection")}
          allLabel={t("filters.allVenues")}
          options={options.stadiums}
          selected={draft.filters.stadium}
          onSelect={(stadium) => setFilters({ stadium })}
        />
      </View>
    </BottomSheetModal>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <AppText variant="overline" tone="muted" accessibilityRole="header">{children}</AppText>;
}

function OptionGroup({
  label,
  allLabel,
  options,
  selected,
  onSelect,
}: {
  label: string;
  allLabel: string;
  options: FilterOption[];
  selected?: string;
  onSelect: (value?: string) => void;
}) {
  const rows = [{ name: allLabel, slug: undefined as string | undefined }, ...options.map((option) => ({ name: option.name, slug: option.slug }))];
  return (
    <View style={local.group} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <SectionTitle>{label}</SectionTitle>
      <View style={local.options}>
        {rows.map((row) => (
          <OptionPill
            key={row.slug ?? "all"}
            label={row.name}
            selected={isDropdownOptionSelected(selected, row.slug)}
            onPress={() => onSelect(row.slug)}
          />
        ))}
      </View>
    </View>
  );
}

/** v3 chip: 38pt, radius 12; selected = filled ink with heavier text (not colour alone). */
function OptionPill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { meta } = useI18n();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      aria-checked={selected}
      hitSlop={3}
      style={({ pressed }) => [
        local.pill,
        // Never `transform: undefined` (see filterChipStyle): it crashed the renderer on release.
        filterChipStyle({ selected, pressed, colors: theme.colors }),
      ]}
    >
      <Text
        numberOfLines={1}
        style={[local.pillText, fontStyleFor("text", selected ? "600" : "500", meta.script), { color: selected ? theme.colors.background : theme.colors.textStrong }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function DateFilter({ value, allowPast, onSelect }: { value?: string; allowPast: boolean; onSelect: (value?: string) => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const todayDate = startOfToday();
  const selectedDate = parseCalendarDate(value);
  const [month, setMonth] = useState(() => startOfMonth(selectedDate ?? todayDate));
  const days = getCalendarDays(month);
  // Upcoming dates start today; Results can browse back.
  const canGoPrevious = allowPast || startOfMonth(addMonths(month, -1)).getTime() >= startOfMonth(todayDate).getTime();
  // Weekday headers from a known Sunday (2023-01-01) in the app locale.
  const weekdays = Array.from({ length: 7 }, (_, index) => formatWeekdayShort(new Date(2023, 0, 1 + index)));

  return (
    <View style={[local.calendar, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]} accessibilityLabel={getDateTriggerLabel(selectedDate)}>
      <View style={local.calendarHeader}>
        <Pressable
          disabled={!canGoPrevious}
          onPress={() => setMonth(addMonths(month, -1))}
          accessibilityRole="button"
          accessibilityLabel={t("filters.previousMonth")}
          aria-disabled={!canGoPrevious}
          style={[local.calendarNav, { opacity: canGoPrevious ? 1 : 0.35 }]}
        >
          <DirectionalChevron kind="back" color={theme.colors.textStrong} />
        </Pressable>
        <AppText variant="cardTitle" align="center">{formatMonthYear(month)}</AppText>
        <Pressable
          onPress={() => setMonth(addMonths(month, 1))}
          accessibilityRole="button"
          accessibilityLabel={t("filters.nextMonth")}
          style={local.calendarNav}
        >
          <DirectionalChevron kind="forward" color={theme.colors.textStrong} />
        </Pressable>
      </View>

      <View style={local.weekRow} accessible={false} importantForAccessibility="no-hide-descendants">
        {weekdays.map((day, index) => (
          <Text key={index} style={[local.weekLabel, { color: theme.colors.textMuted }]}>{day}</Text>
        ))}
      </View>

      <View style={local.calendarGrid}>
        {days.map((date, index) => {
          if (!date) {
            return <View key={`blank-${index}`} accessible={false} style={local.calendarDay} />;
          }
          const disabled = !allowPast && isBeforeDay(date, todayDate);
          const selected = Boolean(selectedDate && isSameDay(date, selectedDate));
          return (
            <Pressable
              key={toDateInputValue(date)}
              disabled={disabled}
              onPress={() => onSelect(toDateInputValue(date))}
              accessibilityRole="button"
              accessibilityLabel={formatAccessibleCalendarDate(date)}
              aria-selected={selected}
              aria-disabled={disabled}
              style={[
                local.calendarDay,
                selected && { backgroundColor: theme.colors.textStrong },
                disabled && local.calendarDayDisabled,
              ]}
            >
              <Text
                style={[
                  local.calendarDayText,
                  { color: selected ? theme.colors.background : disabled ? theme.colors.textMuted : theme.colors.textStrong },
                  selected && local.calendarDaySelected,
                ]}
              >
                {date.getDate()}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const local = {
  // v3 segmented control: 4pt track padding, radius 14; 36pt segments; radius 10 thumb.
  tabs: { flexDirection: "row" as const, padding: 4, borderRadius: 14, position: "relative" as const },
  thumb: {
    position: "absolute" as const,
    top: 4,
    bottom: 4,
    start: 4,
    borderRadius: 10,
    boxShadow: "0px 1px 4px rgba(0,0,0,0.12)",
  },
  tab: {
    flex: 1,
    minHeight: size.touchTargetMin,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
  },
  tabText: { fontSize: 14, lineHeight: 19 },
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  summary: { flex: 1, minWidth: 0 },
  // v3: 34pt, radius 12, `--shadow`; kept at the 44pt touch target via hitSlop.
  filterButton: {
    minHeight: 34,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  clearLink: { minHeight: size.touchTargetMin, justifyContent: "center" as const, paddingHorizontal: 6 },
  // v3 date strip: 8pt gaps; 48x62 chips, radius 16 ("All" 52 wide).
  strip: { flexDirection: "row" as const, gap: spacing.sm, paddingVertical: spacing.xs, paddingHorizontal: 2 },
  dateChip: {
    width: 48,
    height: 62,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 2,
    borderRadius: radius.lg,
  },
  dateChipWide: { width: 52 },
  weekday: { fontSize: 11, lineHeight: 14, opacity: 0.7 },
  fixtureDot: { width: 4, height: 4, borderRadius: 2 },
  sheetBody: { gap: spacing.lg, paddingBottom: spacing.sm },
  group: { gap: 10, paddingTop: spacing.xs },
  options: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.sm },
  pill: {
    minHeight: 38,
    maxWidth: "100%" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 14,
    borderRadius: radius.md,
  },
  pillText: { fontSize: 14, lineHeight: 19, flexShrink: 1 },
  calendar: { borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm },
  calendarHeader: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  calendarNav: { width: size.touchTargetMin, height: size.touchTargetMin, alignItems: "center" as const, justifyContent: "center" as const },
  weekRow: { flexDirection: "row" as const },
  weekLabel: { flex: 1, textAlign: "center" as const, fontSize: 12, fontWeight: "700" as const },
  calendarGrid: { flexDirection: "row" as const, flexWrap: "wrap" as const },
  calendarDay: {
    width: "14.2857%" as const,
    aspectRatio: 1,
    minHeight: 40,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: radius.sm,
  },
  calendarDayDisabled: { opacity: 0.38 },
  calendarDayText: { fontSize: 14, fontWeight: "700" as const },
  calendarDaySelected: { fontWeight: "900" as const },
};
