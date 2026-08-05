import { AppBanner } from "@/components/AppBanner";
import { MatchCard } from "@/components/MatchCard";
import { Empty, Loading, colors, useResponsive, useTheme } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { matchesService } from "@/services/matches";
import type { ApiMatch, FilterOption, MatchFilters } from "@/types";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, Text, View, type DimensionValue } from "react-native";

type MatchesListProps = {
  limit?: number;
  filterable?: boolean;
  showAppBanner?: boolean;
};

export function MatchesList({ limit, filterable = false, showAppBanner = false }: MatchesListProps) {
  const responsive = useResponsive();
  const theme = useTheme();
  const toast = useToast();
  const [matches, setMatches] = useState<ApiMatch[]>([]);
  const [filters, setFilters] = useState<{ teams: FilterOption[]; stadiums: FilterOption[] }>({ teams: [], stadiums: [] });
  const [selected, setSelected] = useState<MatchFilters>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [venueOpen, setVenueOpen] = useState(false);
  const [dateText, setDateText] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(today()));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const columns = responsive.width >= 1120 ? 3 : responsive.width >= 720 ? 2 : 1;
  const wideFilters = responsive.width >= 760;
  const hasFilters = Boolean(selected.team || selected.stadium || selected.date);
  const gridGap = 12;
  const cardWidth: DimensionValue = columns === 1 ? "100%" : (responsive.contentWidth - gridGap * (columns - 1)) / columns;

  const visibleMatches = useMemo(() => {
    const next = limit ? matches.slice(0, limit) : matches;
    return next;
  }, [limit, matches]);

  const load = async (forceRefresh = false) => {
    setError(null);
    if (!forceRefresh) setLoading(true);
    try {
      const [nextMatches, nextFilters] = await Promise.all([matchesService.list(selected, forceRefresh), matchesService.filters(forceRefresh)]);
      setMatches(nextMatches);
      setFilters(nextFilters);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load matches.";
      setError(message);
      toast.showToast({ variant: "error", title: "Could not load matches", message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, [selected.team, selected.stadium, selected.date]);

  const chooseTeam = (team?: string) => {
    setSelected((value) => ({ ...value, team }));
    setTeamOpen(false);
  };

  const chooseVenue = (stadium?: string) => {
    setSelected((value) => ({ ...value, stadium }));
    setVenueOpen(false);
  };

  const applyDate = (date: Date) => {
    const value = toDateInputValue(date);
    setDateText(value);
    setSelected((current) => ({ ...current, date: value }));
    setCalendarOpen(false);
  };

  const clearFilters = () => {
    setSelected({});
    setDateText("");
    setTeamOpen(false);
    setVenueOpen(false);
  };

  if (loading) return <Loading />;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} />}
      contentContainerStyle={local.scrollContent}
    >
      {showAppBanner ? <AppBanner /> : null}

      {filterable ? (
        <View style={[local.filterCard, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
          <Pressable onPress={() => setFiltersOpen((value) => !value)} style={local.filterToggle}>
            <SymbolView name={{ ios: "slider.horizontal.3", android: "tune", web: "tune" } as any} size={20} tintColor={theme.colors.primary} fallback={<Text style={local.filterIcon}>F</Text>} />
            <Text style={[local.filterTitle, { color: theme.colors.ink }]}>Filter Matches</Text>
            {hasFilters ? (
              <Pressable
                onPress={(event) => { event.stopPropagation(); clearFilters(); }}
                style={[local.clearButton, { backgroundColor: theme.colors.panelSoft, borderColor: theme.colors.line }]}
                accessibilityRole="button"
                accessibilityLabel="Clear match filters"
              >
                <SymbolView name={{ ios: "xmark", android: "close", web: "close" } as any} size={15} tintColor={theme.colors.primary} fallback={<Text style={{ color: theme.colors.primary }}>X</Text>} />
              </Pressable>
            ) : null}
            <ChevronIcon open={filtersOpen} color={theme.colors.muted} />
          </Pressable>

          {filtersOpen ? (
            <View style={[local.filterBody, wideFilters && local.filterBodyWide, { borderTopColor: theme.colors.line }]}>
              <Dropdown
                label="Team"
                value={selected.team ? filters.teams.find((team) => team.slug === selected.team)?.name ?? "Team" : "All teams"}
                open={teamOpen}
                options={[{ label: "All teams", value: undefined }, ...filters.teams.map((team) => ({ label: team.name, value: team.slug }))]}
                onToggle={() => { setTeamOpen((value) => !value); setVenueOpen(false); }}
                onSelect={chooseTeam}
                wide={wideFilters}
              />
              <Dropdown
                label="Venue"
                value={selected.stadium ? filters.stadiums.find((stadium) => stadium.slug === selected.stadium)?.name ?? "Venue" : "All venues"}
                open={venueOpen}
                options={[{ label: "All venues", value: undefined }, ...filters.stadiums.map((stadium) => ({ label: stadium.name, value: stadium.slug }))]}
                onToggle={() => { setVenueOpen((value) => !value); setTeamOpen(false); }}
                onSelect={chooseVenue}
                wide={wideFilters}
              />
              <View style={[local.fieldWrap, wideFilters && local.fieldWrapWide]}>
                <Text style={[local.fieldLabel, { color: theme.colors.secondary }]}>Match Date</Text>
                <Pressable onPress={() => setCalendarOpen(true)} style={[local.dateInputWrap, { borderColor: theme.colors.line, backgroundColor: theme.colors.panel }]}>
                  <Text style={[local.dateInputText, { color: dateText ? theme.colors.ink : theme.colors.muted }]}>{dateText || "Select date"}</Text>
                  <SymbolView name={{ ios: "calendar", android: "calendar_month", web: "calendar_month" } as any} size={17} tintColor={theme.colors.ink} fallback={<Text style={{ color: theme.colors.ink }}>Cal</Text>} />
                </Pressable>
              </View>
              <CalendarModal
                visible={calendarOpen}
                month={calendarMonth}
                selectedValue={dateText}
                onMonthChange={setCalendarMonth}
                onSelect={applyDate}
                onClose={() => setCalendarOpen(false)}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {error ? <Empty title="Could not load matches" detail={error} /> : null}

      {visibleMatches.length ? (
        <View style={local.listBar}>
          <Text style={[local.listTitle, { color: theme.colors.ink }]}>{limit ? "Latest matches" : "Scheduled matches"}</Text>
          <Text style={[local.resultCount, { color: theme.colors.muted }]}>{visibleMatches.length} match{visibleMatches.length === 1 ? "" : "es"}</Text>
        </View>
      ) : null}

      {visibleMatches.length ? (
        <View style={local.matchGrid}>
          {visibleMatches.map((match) => <MatchCard key={match.id} match={match} width={cardWidth} />)}
        </View>
      ) : !error ? <Empty title="No scheduled matches" detail="Pull to refresh or change filters when matches become available." /> : null}
    </ScrollView>
  );
}

function Dropdown({
  label,
  value,
  open,
  options,
  onToggle,
  onSelect,
  wide,
}: {
  label: string;
  value: string;
  open: boolean;
  options: Array<{ label: string; value?: string }>;
  onToggle: () => void;
  onSelect: (value?: string) => void;
  wide?: boolean;
}) {
  const theme = useTheme();

  return (
    <View style={[local.fieldWrap, wide && local.fieldWrapWide]}>
      <Text style={[local.fieldLabel, { color: theme.colors.secondary }]}>{label}</Text>
      <Pressable onPress={onToggle} style={[local.selectInput, { borderColor: theme.colors.line, backgroundColor: theme.colors.panel }]}>
        <Text numberOfLines={1} style={[local.selectText, { color: theme.colors.muted }]}>{value}</Text>
        <ChevronIcon open={open} color={theme.colors.muted} />
      </Pressable>
      {open ? (
        <View style={[local.optionsPanel, { borderColor: theme.colors.line, backgroundColor: theme.colors.panel }]}>
          {options.map((option) => (
            <Pressable key={option.value ?? "all"} onPress={() => onSelect(option.value)} style={[local.optionRow, option.value === undefined && local.optionRowActive]}>
              <Text numberOfLines={1} style={[local.optionText, option.value === undefined && local.optionTextActive]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ChevronIcon({ open, color }: { open: boolean; color: string }) {
  return (
    <SymbolView
      name={(open ? { ios: "chevron.up", android: "keyboard_arrow_up", web: "keyboard_arrow_up" } : { ios: "chevron.down", android: "keyboard_arrow_down", web: "keyboard_arrow_down" }) as any}
      size={18}
      tintColor={color}
      fallback={<Text style={[local.selectChevron, { color }]}>{open ? "Up" : "Down"}</Text>}
    />
  );
}

function CalendarModal({
  visible,
  month,
  selectedValue,
  onMonthChange,
  onSelect,
  onClose,
}: {
  visible: boolean;
  month: Date;
  selectedValue: string;
  onMonthChange: (date: Date) => void;
  onSelect: (date: Date) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const todayDate = today();
  const selectedDate = selectedValue ? parseDateValue(selectedValue) : null;
  const days = getCalendarDays(month);
  const canGoPrevious = startOfMonth(addMonths(month, -1)).getTime() >= startOfMonth(todayDate).getTime();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={local.calendarOverlay}>
        <View style={[local.calendarPanel, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
          <View style={local.calendarHeader}>
            <Pressable
              disabled={!canGoPrevious}
              onPress={() => onMonthChange(addMonths(month, -1))}
              style={[local.calendarNav, { opacity: canGoPrevious ? 1 : 0.35 }]}
            >
              <SymbolView name={{ ios: "chevron.left", android: "keyboard_arrow_left", web: "keyboard_arrow_left" } as any} size={20} tintColor={theme.colors.ink} fallback={<Text style={{ color: theme.colors.ink }}>Prev</Text>} />
            </Pressable>
            <Text style={[local.calendarTitle, { color: theme.colors.ink }]}>{monthLabel(month)}</Text>
            <Pressable onPress={() => onMonthChange(addMonths(month, 1))} style={local.calendarNav}>
              <SymbolView name={{ ios: "chevron.right", android: "keyboard_arrow_right", web: "keyboard_arrow_right" } as any} size={20} tintColor={theme.colors.ink} fallback={<Text style={{ color: theme.colors.ink }}>Next</Text>} />
            </Pressable>
          </View>

          <View style={local.weekRow}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <Text key={day} style={[local.weekLabel, { color: theme.colors.muted }]}>{day}</Text>
            ))}
          </View>

          <View style={local.calendarGrid}>
            {days.map((date, index) => {
              const disabled = !date || isBeforeDay(date, todayDate);
              const selected = Boolean(date && selectedDate && isSameDay(date, selectedDate));
              return (
                <Pressable
                  key={date ? toDateInputValue(date) : `blank-${index}`}
                  disabled={disabled}
                  onPress={() => date && onSelect(date)}
                  style={[
                    local.calendarDay,
                    selected && { backgroundColor: theme.colors.primary },
                    disabled && local.calendarDayDisabled,
                  ]}
                >
                  <Text style={[
                    local.calendarDayText,
                    { color: disabled ? theme.colors.muted : theme.colors.ink },
                    selected && local.calendarDayTextSelected,
                  ]}>
                    {date ? date.getDate() : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={local.calendarActions}>
            <Pressable onPress={onClose} style={[local.calendarButton, { borderColor: theme.colors.line }]}>
              <Text style={[local.calendarButtonText, { color: theme.colors.ink }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function today() {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function getCalendarDays(month: Date) {
  const first = startOfMonth(month);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const days: Array<Date | null> = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= last.getDate(); day += 1) {
    days.push(new Date(month.getFullYear(), month.getMonth(), day));
  }
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function isBeforeDay(left: Date, right: Date) {
  return todayValue(left) < todayValue(right);
}

function isSameDay(left: Date, right: Date) {
  return todayValue(left) === todayValue(right);
}

function todayValue(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}

const local = {
  scrollContent: { gap: 12, paddingBottom: 28 },
  filterCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    overflow: "hidden" as const,
    marginTop: 8,
  },
  filterToggle: {
    minHeight: 58,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingHorizontal: 14,
  },
  filterIcon: { color: colors.primary, fontSize: 18, fontWeight: "900" as const },
  filterTitle: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "900" as const },
  clearButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  filterBody: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    padding: 12,
    gap: 12,
  },
  filterBodyWide: { flexDirection: "row" as const, alignItems: "flex-start" as const },
  fieldWrap: { gap: 5 },
  fieldWrapWide: { flex: 1, minWidth: 0 },
  fieldLabel: {
    color: colors.secondary,
    fontSize: 12,
    fontWeight: "900" as const,
    textTransform: "uppercase" as const,
    paddingLeft: 6,
  },
  selectInput: {
    minHeight: 44,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    gap: 8,
  },
  selectText: { flex: 1, minWidth: 0, color: colors.muted, fontSize: 13, fontWeight: "700" as const },
  selectChevron: { color: colors.muted, fontSize: 18, lineHeight: 18 },
  optionsPanel: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
  },
  optionRow: {
    minHeight: 26,
    justifyContent: "center" as const,
    paddingHorizontal: 12,
  },
  optionRowActive: { backgroundColor: colors.primary },
  optionText: { color: colors.muted, fontSize: 13 },
  optionTextActive: { color: "#FFFFFF", fontWeight: "900" as const },
  dateInputWrap: {
    minHeight: 44,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    gap: 8,
  },
  dateInputText: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 13, fontWeight: "700" as const },
  calendarOverlay: {
    flex: 1,
    backgroundColor: "rgba(21,26,44,0.44)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: 18,
  },
  calendarPanel: {
    width: "100%" as const,
    maxWidth: 380,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    padding: 14,
    gap: 12,
  },
  calendarHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  calendarNav: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  calendarTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" as const },
  weekRow: { flexDirection: "row" as const },
  weekLabel: { flex: 1, textAlign: "center" as const, color: colors.muted, fontSize: 11, fontWeight: "900" as const },
  calendarGrid: { flexDirection: "row" as const, flexWrap: "wrap" as const },
  calendarDay: {
    width: "14.2857%" as const,
    aspectRatio: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: 8,
  },
  calendarDayDisabled: { opacity: 0.38 },
  calendarDayText: { color: colors.ink, fontSize: 13, fontWeight: "800" as const },
  calendarDayTextSelected: { color: "#FFFFFF" },
  calendarActions: { alignItems: "flex-end" as const },
  calendarButton: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: "center" as const,
    paddingHorizontal: 14,
  },
  calendarButtonText: { color: colors.ink, fontSize: 13, fontWeight: "900" as const },
  listBar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingTop: 2,
  },
  listTitle: { color: colors.ink, fontSize: 17, fontWeight: "900" as const },
  resultCount: { color: colors.muted, fontSize: 12, fontWeight: "800" as const, textTransform: "uppercase" as const },
  matchGrid: {
    width: "100%" as const,
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 12,
    alignItems: "stretch" as const,
  },
};
