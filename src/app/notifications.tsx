import { FlowHeader } from "@/components/FlowHeader";
import { AppText, SkeletonBlock, SkeletonGroup, StatePanel } from "@/components/foundation";
import { TeamCrest } from "@/components/match/TeamCrest";
import { Screen, useResponsive, useTheme } from "@/components/ui";
import { withAuthRequired } from "@/components/withAuthRequired";
import { useI18n } from "@/i18n/I18nProvider";
import { spacing } from "@/lib/designTokens";
import { formatTime, getFormatLocale } from "@/lib/format";
import { groupInbox, notificationMatchTarget, type InboxGroupKey, type InboxNotification, type InboxTeam } from "@/lib/notificationInbox";
import { createRequestAuthority } from "@/lib/requestAuthority";
import { getUserScopedCacheGeneration, onUserScopedCacheInvalidated } from "@/lib/userScopedCache";
import { notificationReads, onNotificationsInvalidated } from "@/services/cachedReads";
import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";

type LoadMode = "load" | "retry" | "refresh" | "revalidate";

/**
 * Notifications (LFA Screen v3 `notifs`). Everything shown is the backend
 * inbox (`GET /portal/notifications`) through the identity-scoped portal
 * cache; the "N new" pill is the backend unread count. The API is read-only:
 * opening a notification never marks it read or lowers the count, and there
 * is no "Mark all as read" (no such API). Only `target_type === "match"` with
 * a valid match opens a screen (Match Details); every other notification is a
 * plain row with no invented destination.
 */
function NotificationsScreen() {
  const i18n = useI18n();
  const theme = useTheme();
  const responsive = useResponsive();
  // A recent inbox renders at once on revisit; the cache decides whether to re-read.
  const [cached] = useState(() => notificationReads.peekList());
  const [items, setItems] = useState<InboxNotification[]>(() => cached?.value ?? []);
  const [loadedAt, setLoadedAt] = useState(() => cached?.fetchedAt ?? 0);
  const [loading, setLoading] = useState(cached === null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [unread, setUnread] = useState<number | null>(() => notificationReads.peekUnreadCount()?.value ?? null);
  const [listRequest] = useState(createRequestAuthority);
  const [countRequest] = useState(createRequestAuthority);

  const load = useCallback((mode: LoadMode) => {
    const force = mode === "retry" || mode === "refresh";
    const generation = getUserScopedCacheGeneration();
    const listTicket = listRequest.begin("list");
    const countTicket = countRequest.begin("count");
    const listCurrent = () => listRequest.isCurrent(listTicket) && generation === getUserScopedCacheGeneration();
    const countCurrent = () => countRequest.isCurrent(countTicket) && generation === getUserScopedCacheGeneration();
    if (mode === "retry") {
      setLoading(true);
      setError(false);
    }
    const list = notificationReads
      .list(force)
      .then((next) => {
        if (!listCurrent()) return;
        setItems(next);
        setLoadedAt(notificationReads.peekList()?.fetchedAt ?? Date.now());
        setError(false);
      })
      .catch(() => {
        // A failed background re-read keeps what is shown; otherwise the error state.
        if (listCurrent() && mode !== "revalidate") setError(true);
      })
      .finally(() => {
        if (listCurrent()) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    const count = notificationReads
      .unreadCount(force)
      .then((next) => {
        if (countCurrent()) setUnread(next);
      })
      .catch(() => {});
    return Promise.all([list, count]);
  }, [countRequest, listRequest]);

  useEffect(() => {
    listRequest.mount();
    countRequest.mount();
    return () => {
      listRequest.unmount();
      countRequest.unmount();
    };
  }, [countRequest, listRequest]);

  useEffect(() => {
    let active = true;
    // Deferred a tick so no state is set synchronously inside the effect.
    void Promise.resolve().then(() => {
      if (active) return load("load");
    });
    return () => {
      active = false;
    };
  }, [load]);

  // A push arrived or was opened: re-read quietly (what the backend says next).
  useEffect(() => onNotificationsInvalidated(() => void load("revalidate")), [load]);

  // Identity change: never keep another account's inbox on screen.
  useEffect(() => onUserScopedCacheInvalidated(() => {
    listRequest.invalidate();
    countRequest.invalidate();
    setItems([]);
    setUnread(null);
    setLoading(true);
  }), [countRequest, listRequest]);

  const refresh = () => {
    setRefreshing(true);
    void load("refresh");
  };

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const groups = groupInbox(items, new Date(loadedAt || 0));

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false, title: i18n.t("notifications.title") }} />
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <FlowHeader title="" backLabel={i18n.t("nav.home")} onBack={back} />
        <View style={local.titleRow}>
          <AppText variant="displayTitle" accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={local.title}>
            {i18n.t("notifications.title")}
          </AppText>
          {unread ? (
            <View style={[local.newPill, { backgroundColor: theme.colors.actionPrimary }]}>
              <AppText style={local.newPillText}>{i18n.t("notifications.newCount", { count: unread > 99 ? "99+" : String(unread) })}</AppText>
            </View>
          ) : null}
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={local.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        >
          {loading && items.length === 0 ? (
            <SkeletonGroup label={i18n.t("notifications.loading")}>
              <SkeletonBlock width="30%" height={14} />
              {[0, 1, 2, 3].map((key) => <SkeletonBlock key={key} width="100%" height={74} borderRadius={16} />)}
            </SkeletonGroup>
          ) : error && items.length === 0 ? (
            <StatePanel
              variant="error"
              title={i18n.t("notifications.error.title")}
              message={i18n.t("notifications.error.message")}
              action={{ label: i18n.t("common.retry"), onPress: () => void load("retry") }}
            />
          ) : items.length === 0 ? (
            <StatePanel variant="empty" title={i18n.t("notifications.empty.title")} message={i18n.t("notifications.empty.message")} />
          ) : (
            groups.map((group) => (
              <View key={group.key} style={local.group}>
                <AppText variant="overline" tone="muted" accessibilityRole="header" style={local.groupLabel}>
                  {i18n.t(`notifications.group.${group.key}`)}
                </AppText>
                <View style={[local.card, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
                  {group.items.map((item, index) => (
                    <NotificationRow key={item.id} item={item} groupKey={group.key} first={index === 0} />
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Screen>
  );
}

/** Today / Yesterday: the time; Earlier: the short date. Unknown time: nothing. */
function rowTime(item: InboxNotification, groupKey: InboxGroupKey) {
  if (!item.sentAt) return null;
  if (groupKey !== "earlier") return formatTime(item.sentAt);
  const date = new Date(item.sentAt);
  return new Intl.DateTimeFormat(getFormatLocale(), { day: "numeric", month: "short" }).format(date);
}

/** The crest component's team shape; a missing team id is not needed to draw a crest. */
function crestTeam(team: InboxTeam) {
  return { id: team.id ?? 0, name: team.name, short_name: team.shortName, logo: team.logo };
}

function NotificationRow({ item, groupKey, first }: { item: InboxNotification; groupKey: InboxGroupKey; first: boolean }) {
  const i18n = useI18n();
  const theme = useTheme();
  const matchId = notificationMatchTarget(item);
  const time = rowTime(item, groupKey);
  const home = item.match?.homeTeam ?? null;
  const away = item.match?.awayTeam ?? null;
  const teams = home && away ? { home, away } : null;
  const fixture = teams ? i18n.t("notifications.fixture", { home: teams.home.name, away: teams.away.name }) : null;
  const label = [item.isUnread ? i18n.t("notifications.unread.a11y") : null, item.title, item.body, fixture, time].filter(Boolean).join(". ");
  const rowStyle = [
    local.row,
    !first && { borderTopWidth: 1, borderTopColor: theme.colors.hairline },
    item.isUnread && { backgroundColor: theme.colors.tones.brand.bg },
  ];

  const content = (
    <>
      <View style={[local.tile, { backgroundColor: theme.colors.tones.brand.bg }]}>
        <SymbolView
          accessible={false}
          name={(matchId
            ? { ios: "sportscourt", android: "sports_soccer", web: "sports_soccer" }
            : { ios: "bell", android: "notifications_none", web: "notifications_none" }) as never}
          size={20}
          tintColor={theme.colors.actionPrimary}
          fallback={<View />}
        />
      </View>
      <View style={local.copy}>
        <View style={local.titleLine}>
          <AppText variant="body" style={[local.rowTitle, { fontWeight: item.isUnread ? "600" : "400" }]}>{item.title}</AppText>
          {time ? <AppText variant="caption" tone="muted" style={local.time}>{time}</AppText> : null}
        </View>
        {item.body ? <AppText variant="meta" tone="muted" style={local.body}>{item.body}</AppText> : null}
        {teams && fixture ? (
          <View style={local.fixture}>
            <TeamCrest team={crestTeam(teams.home)} size={18} />
            <TeamCrest team={crestTeam(teams.away)} size={18} />
            <AppText variant="caption" tone="muted" numberOfLines={1} style={local.fixtureText}>{fixture}</AppText>
          </View>
        ) : null}
      </View>
      <View style={[local.dot, { backgroundColor: theme.colors.actionPrimary, opacity: item.isUnread ? 1 : 0 }]} />
    </>
  );

  if (!matchId) {
    // No destination: a plain row, not a control.
    return (
      <View style={rowStyle} accessible accessibilityLabel={label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/match/[id]", params: { id: matchId } })}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={i18n.t("notifications.openMatch.hint")}
      style={({ pressed }) => [...rowStyle, pressed && { opacity: 0.85 }]}
    >
      {content}
    </Pressable>
  );
}

// LFA Screen v3 notifs: title row padding 4 20 12, gap 10; "N new" pill 4 10, 13/700;
// group label 12/600 uppercase .08em, padding 14 4 8; card radius 20 with the card
// shadow; row grid 40 1fr 10, gap 12, padding 14 16; tile 40 radius 12; title 15/1.3
// (600 unread / 400 read), time 12 muted; body 14/1.4 muted; unread dot 8.
const local = {
  shell: { flex: 1, alignSelf: "center" as const },
  titleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingTop: 4, paddingHorizontal: spacing.xs, paddingBottom: 12 },
  title: { flexShrink: 1 },
  newPill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999 },
  newPillText: { color: "#FFFFFF", fontSize: 13, lineHeight: 17, fontWeight: "700" as const },
  content: { paddingBottom: spacing.xxxl, gap: spacing.xs },
  group: { gap: 0 },
  groupLabel: { paddingTop: 14, paddingHorizontal: 4, paddingBottom: 8 },
  card: { borderRadius: 20, overflow: "hidden" as const },
  row: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: "center" as const, justifyContent: "center" as const },
  copy: { flex: 1, minWidth: 0 },
  titleLine: { flexDirection: "row" as const, justifyContent: "space-between" as const, gap: 8 },
  rowTitle: { flex: 1, fontSize: 15, lineHeight: 19.5 },
  time: { paddingTop: 2 },
  body: { marginTop: 3, fontSize: 14, lineHeight: 19.6 },
  fixture: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginTop: 8 },
  fixtureText: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
};

export default withAuthRequired(NotificationsScreen);
