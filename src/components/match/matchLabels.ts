import type { useI18n } from "@/i18n/I18nProvider";
import { formatCalendarDate, formatTime } from "@/lib/format";
import { matchStatusPresentation } from "@/lib/matchDiscovery";
import type { ApiMatch } from "@/types";

type I18n = ReturnType<typeof useI18n>;

/** Visible/spoken strings for one match, derived only from backend fields. */
export function matchLabels(match: ApiMatch, i18n: I18n) {
  const status = matchStatusPresentation(match.status);
  const home = match.home_team?.name ?? "—";
  const away = match.away_team?.name ?? "—";
  const date = formatCalendarDate(match.match_date);
  const time = formatTime(match.kickoff_at);
  const venue = match.stadium?.name ?? i18n.t("match.venueTbc");
  const statusLabel =
    status.known === "scheduled"
      ? i18n.t("match.status.scheduled")
      : status.known === "unknown"
        ? i18n.t("match.status.unknown")
        : status.raw;
  return { home, away, date, time, venue, statusLabel, statusTone: status.tone, isScheduled: status.known === "scheduled" };
}
