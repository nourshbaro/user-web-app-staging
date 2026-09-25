import { BottomSheetModal } from "@/components/BottomSheetModal";
import { AppText, DirectionalChevron } from "@/components/foundation";
import { Button, useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { radius, size, spacing } from "@/lib/designTokens";
import { formatAccessibleCalendarDate, formatCalendarDate, formatMonthYear, formatWeekdayShort, parseCalendarDate } from "@/lib/format";
import { getDateTriggerLabel, isDropdownOptionSelected } from "@/lib/matchFilterAccessibility";
import {
  activeFilterCount,
  addMonths,
  getCalendarDays,
  isBeforeDay,
  isSameDay,
  startOfMonth,
  startOfToday,
  toDateInputValue,
} from "@/lib/matchDiscovery";
import type { FilterOption, MatchFilters } from "@/types";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

type FilterOptions = { teams: FilterOption[]; stadiums: FilterOption[] };

function optionName(options: FilterOption[], slug?: string) {
  return slug ? options.find((option) => option.slug === slug)?.name ?? slug : undefined;
}

/**
 * Filter entry point + visible active-filter state. Filter values are owned by
 * the Matches screen; this bar only reports intent through callbacks.
 */
export function MatchFilterBar({
  filters,
  options,
  sheetOpen,
  onOpen,
  onChange,
  onClear,
}: {
  filters: MatchFilters;
  options: FilterOptions;
  sheetOpen: boolean;
  onOpen: () => void;
  onChange: (next: MatchFilters) => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  const { t, plural } = useI18n();
  const count = activeFilterCount(filters);
  const chips = [
    filters.team ? { key: "team" as const, label: optionName(options.teams, filters.team) ?? filters.team } : null,
    filters.stadium ? { key: "stadium" as const, label: optionName(options.stadiums, filters.stadium) ?? filters.stadium } : null,
    filters.date ? { key: "date" as const, label: formatCalendarDate(filters.date) } : null,
  ].filter((chip): chip is { key: "team" | "stadium" | "date"; label: string } => chip !== null);

  return (
    <View style={local.bar}>
      <View style={local.row}>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={count ? plural("filters.openActive", count) : t("filters.open")}
          aria-expanded={sheetOpen}
          style={({ pressed }) => [
            local.filterButton,
            {
              backgroundColor: count ? theme.colors.selectedSurface : theme.colors.surface,
              borderColor: count ? theme.colors.actionPrimary : theme.colors.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <SymbolView
            accessible={false}
            name={{ ios: "slider.horizontal.3", android: "tune", web: "tune" } as never}
            size={18}
            tintColor={count ? theme.colors.tones.brand.fg : theme.colors.textStrong}
            fallback={<View />}
          />
          <AppText variant="label" tone={count ? "brand" : "strong"}>{t("filters.open")}</AppText>
          {count ? (
            // Count badge: filtered state is shown by shape and number, not colour alone.
            <View style={[local.countBadge, { backgroundColor: theme.colors.actionPrimary }]}>
              <Text style={[local.countText, { color: theme.colors.onActionPrimary }]}>{count}</Text>
            </View>
          ) : null}
        </Pressable>

        {count ? (
          <Pressable
            onPress={onClear}
            accessibilityRole="button"
            accessibilityLabel={t("filters.clear")}
            hitSlop={8}
            style={({ pressed }) => [local.clearLink, pressed && { opacity: 0.7 }]}
          >
            <AppText variant="label" tone="brand">{t("filters.clear")}</AppText>
          </Pressable>
        ) : null}
      </View>

      {chips.length ? (
        <View style={local.chips}>
          {chips.map((chip) => (
            <Pressable
              key={chip.key}
              onPress={() => onChange({ ...filters, [chip.key]: undefined })}
              accessibilityRole="button"
              accessibilityLabel={t("filters.removeChip", { label: chip.label })}
              style={({ pressed }) => [
                local.chip,
                { backgroundColor: theme.colors.tones.brand.bg, borderColor: theme.colors.tones.brand.border, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <AppText variant="caption" tone="brand" numberOfLines={1} style={local.chipText}>{chip.label}</AppText>
              <SymbolView
                accessible={false}
                name={{ ios: "xmark", android: "close", web: "close" } as never}
                size={12}
                tintColor={theme.colors.tones.brand.fg}
                fallback={<Text accessible={false} style={{ color: theme.colors.tones.brand.fg }}>×</Text>}
              />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Focused filter surface. Each selection is reported immediately through
 * `onChange` (as before), so the screen's request authority keeps owning the
 * fetch; the sheet holds only presentation state (the visible calendar month).
 */
export function MatchFiltersSheet({
  visible,
  filters,
  options,
  onChange,
  onClear,
  onClose,
}: {
  visible: boolean;
  filters: MatchFilters;
  options: FilterOptions;
  onChange: (next: MatchFilters) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const count = activeFilterCount(filters);

  return (
    <BottomSheetModal visible={visible} onClose={onClose} title={t("filters.sheetTitle")} scrollable wide>
      <View style={local.sheetBody}>
        <OptionGroup
          label={t("filters.team")}
          allLabel={t("filters.allTeams")}
          options={options.teams}
          selected={filters.team}
          onSelect={(team) => onChange({ ...filters, team })}
        />
        <OptionGroup
          label={t("filters.venue")}
          allLabel={t("filters.allVenues")}
          options={options.stadiums}
          selected={filters.stadium}
          onSelect={(stadium) => onChange({ ...filters, stadium })}
        />
        <DateFilter
          value={filters.date}
          onSelect={(date) => onChange({ ...filters, date })}
        />
        <View style={local.sheetActions}>
          {count ? <Button title={t("filters.clear")} variant="secondary" onPress={onClear} /> : null}
          <Button title={t("filters.done")} onPress={onClose} />
        </View>
      </View>
    </BottomSheetModal>
  );
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
      <AppText variant="label" tone="muted" accessibilityRole="header">{label}</AppText>
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

function OptionPill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      aria-checked={selected}
      style={({ pressed }) => [
        local.pill,
        {
          backgroundColor: selected ? theme.colors.actionPrimary : theme.colors.surface,
          borderColor: selected ? theme.colors.actionPrimary : theme.colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {selected ? (
        // A checkmark marks the selection in addition to colour.
        <SymbolView accessible={false} name={{ ios: "checkmark", android: "check", web: "check" } as never} size={14} tintColor={theme.colors.onActionPrimary} fallback={<View />} />
      ) : null}
      <Text numberOfLines={1} style={[local.pillText, { color: selected ? theme.colors.onActionPrimary : theme.colors.textStrong }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function DateFilter({ value, onSelect }: { value?: string; onSelect: (value?: string) => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const todayDate = startOfToday();
  const selectedDate = parseCalendarDate(value);
  const [month, setMonth] = useState(() => startOfMonth(selectedDate ?? todayDate));
  const days = getCalendarDays(month);
  const canGoPrevious = startOfMonth(addMonths(month, -1)).getTime() >= startOfMonth(todayDate).getTime();
  // Weekday headers from a known Sunday (2023-01-01) in the app locale.
  const weekdays = Array.from({ length: 7 }, (_, index) => formatWeekdayShort(new Date(2023, 0, 1 + index)));

  return (
    <View style={local.group}>
      <AppText variant="label" tone="muted" accessibilityRole="header" accessibilityLabel={getDateTriggerLabel(selectedDate)}>
        {t("filters.date")}
      </AppText>
      <View style={local.options}>
        <OptionPill label={t("filters.anyDate")} selected={!value} onPress={() => onSelect(undefined)} />
      </View>

      <View style={[local.calendar, { borderColor: theme.colors.border }]}>
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
            const disabled = isBeforeDay(date, todayDate);
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
                  selected && { backgroundColor: theme.colors.actionPrimary },
                  disabled && local.calendarDayDisabled,
                ]}
              >
                <Text
                  style={[
                    local.calendarDayText,
                    { color: selected ? theme.colors.onActionPrimary : disabled ? theme.colors.textMuted : theme.colors.textStrong },
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
    </View>
  );
}

const local = {
  bar: { gap: spacing.sm },
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md },
  filterButton: {
    minHeight: size.touchTargetMin,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  countBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: "center" as const, justifyContent: "center" as const },
  countText: { fontSize: 12, fontWeight: "800" as const },
  clearLink: { minHeight: size.touchTargetMin, justifyContent: "center" as const },
  chips: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.sm },
  chip: {
    minHeight: 32,
    maxWidth: "100%" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: { flexShrink: 1 },
  sheetBody: { gap: spacing.xl, paddingBottom: spacing.sm },
  sheetActions: { gap: spacing.sm },
  group: { gap: spacing.sm },
  options: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.sm },
  pill: {
    minHeight: size.touchTargetMin,
    maxWidth: "100%" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pillText: { fontSize: 14, lineHeight: 19, fontWeight: "700" as const, flexShrink: 1 },
  calendar: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
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
