import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  groupInbox,
  inboxGroupKey,
  notificationMatchTarget,
  parseInboxNotification,
  parseInboxNotifications,
  parseUnreadCount,
  unreadBadgeLabel,
} from "./notificationInbox.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

/** The documented backend example. */
const EXAMPLE = {
  data: [
    {
      id: 23,
      title: "Match rescheduled",
      body: "The match has a new date/time: 2026-10-22 16:30.",
      data: null,
      target_type: "match",
      match: {
        id: 3,
        match_date: "2026-10-22",
        kickoff_at: "16:30:00",
        status: "scheduled",
        home_score: null,
        away_score: null,
        clock_minute: null,
        clock_running: false,
        home_team: { id: 2, name: "Ansar", short_name: null, logo: "teams/ansar.png" },
        away_team: { id: 3, name: "Juwaya Al Riyadi", short_name: null, logo: "..." },
      },
      sent_at: "2026-09-24T08:20:04.000000Z",
      is_unread: true,
    },
  ],
};

/* Parsing --------------------------------------------------------------------- */

test("the documented response parses into a notification with its match", () => {
  const [item] = parseInboxNotifications(EXAMPLE);
  assert.deepEqual(item, {
    id: "23",
    title: "Match rescheduled",
    body: "The match has a new date/time: 2026-10-22 16:30.",
    targetType: "match",
    match: {
      id: 3,
      matchDate: "2026-10-22",
      kickoffAt: "16:30:00",
      status: "scheduled",
      homeTeam: { id: 2, name: "Ansar", shortName: null, logo: "teams/ansar.png" },
      awayTeam: { id: 3, name: "Juwaya Al Riyadi", shortName: null, logo: "..." },
    },
    sentAt: "2026-09-24T08:20:04.000000Z",
    isUnread: true,
  });
});

test("nullable data, match, teams and other optional fields are tolerated", () => {
  const item = parseInboxNotification({ id: 1, title: "Hello", body: null, data: null, target_type: null, match: null, sent_at: null, is_unread: false });
  assert.deepEqual(item, { id: "1", title: "Hello", body: "", targetType: null, match: null, sentAt: null, isUnread: false });
  const partial = parseInboxNotification({ id: 2, body: "Body only", match: { id: 9, home_team: null, away_team: { name: "" } } });
  assert.equal(partial.title, "Body only", "a body-only notification uses its body as the title");
  assert.equal(partial.body, "");
  assert.deepEqual(partial.match, { id: 9, matchDate: null, kickoffAt: null, status: null, homeTeam: null, awayTeam: null });
});

test("unread is only ever the backend's is_unread === true", () => {
  for (const value of [true]) assert.equal(parseInboxNotification({ id: 1, title: "x", is_unread: value }).isUnread, true);
  for (const value of [false, "true", 1, null, undefined]) assert.equal(parseInboxNotification({ id: 1, title: "x", is_unread: value }).isUnread, false, String(value));
});

test("items that cannot be shown honestly are dropped; the rest stay", () => {
  const items = parseInboxNotifications({ data: [null, "x", { title: "no id" }, { id: 5 }, { id: 6, title: "  " }, { id: 7, title: "ok" }] });
  assert.deepEqual(items.map((item) => item.id), ["7"]);
});

test("an unparseable sent_at is no time, never an invented one", () => {
  assert.equal(parseInboxNotification({ id: 1, title: "x", sent_at: "yesterday-ish" }).sentAt, null);
});

test("a malformed collection is an error, not an empty inbox", () => {
  for (const payload of [null, {}, { data: null }, { data: {} }, "nope"]) {
    assert.throws(() => parseInboxNotifications(payload), /Invalid notifications response/, JSON.stringify(payload));
  }
  assert.deepEqual(parseInboxNotifications({ data: [] }), []);
});

/* Navigation ------------------------------------------------------------------ */

test("only target_type match with a valid match id opens Match Details", () => {
  const [match] = parseInboxNotifications(EXAMPLE);
  assert.equal(notificationMatchTarget(match), "3");
  const noMatch = parseInboxNotification({ id: 1, title: "x", target_type: "match", match: null });
  assert.equal(notificationMatchTarget(noMatch), null);
  const badId = parseInboxNotification({ id: 1, title: "x", target_type: "match", match: { id: "3" } });
  assert.equal(notificationMatchTarget(badId), null, "a non-numeric id is not a valid match");
});

test("a generic notification has no invented destination", () => {
  for (const targetType of [null, "all", "general", "ticket", "Match"]) {
    const item = parseInboxNotification({ id: 1, title: "x", target_type: targetType, match: { id: 3 } });
    assert.equal(notificationMatchTarget(item), null, String(targetType));
  }
});

/* Unread count ------------------------------------------------------------------ */

test("the unread count is a non-negative integer from the backend; anything else is an error, never 0", () => {
  assert.equal(parseUnreadCount({ unread_count: 0 }), 0);
  assert.equal(parseUnreadCount({ unread_count: 12 }), 12);
  assert.equal(parseUnreadCount({ data: { unread_count: 3 } }), 3);
  for (const payload of [null, {}, { unread_count: -1 }, { unread_count: 1.5 }, { unread_count: "4" }]) {
    assert.throws(() => parseUnreadCount(payload), /Invalid unread count/, JSON.stringify(payload));
  }
});

test("the Home badge hides at 0 / unknown and caps at 99+", () => {
  assert.equal(unreadBadgeLabel(null), null);
  assert.equal(unreadBadgeLabel(0), null);
  assert.equal(unreadBadgeLabel(7), "7");
  assert.equal(unreadBadgeLabel(120), "99+");
});

/* Grouping ------------------------------------------------------------------------- */

test("Today / Yesterday / Earlier by local day, newest first; no time → Earlier", () => {
  const now = new Date(2026, 9, 5, 12, 0);
  const at = (d, h) => new Date(2026, 9, d, h, 0).toISOString();
  const items = [
    parseInboxNotification({ id: 1, title: "older", sent_at: at(1, 9) }),
    parseInboxNotification({ id: 2, title: "today early", sent_at: at(5, 8) }),
    parseInboxNotification({ id: 3, title: "yesterday", sent_at: at(4, 20) }),
    parseInboxNotification({ id: 4, title: "today late", sent_at: at(5, 11) }),
    parseInboxNotification({ id: 5, title: "no time" }),
  ];
  const groups = groupInbox(items, now);
  assert.deepEqual(groups.map((group) => [group.key, group.items.map((item) => item.id)]), [
    ["today", ["4", "2"]],
    ["yesterday", ["3"]],
    ["earlier", ["1", "5"]],
  ]);
  assert.equal(inboxGroupKey(null, now), "earlier");
});

/* Screens (source) ---------------------------------------------------------------- */

test("the inbox and Home never mark read or lower the count locally", async () => {
  // Code only: comments explain that nothing is marked read.
  const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const path of ["../app/notifications.tsx", "../hooks/useUnreadNotificationCount.ts", "../components/TabHeader.tsx", "../components/HomeFeed.tsx"]) {
    const source = code(await read(path));
    assert.doesNotMatch(source, /mark.?(all.?)?(as.?)?read|isUnread\s*[:=]\s*false|setUnread\(\s*\(?\w*\)?\s*=>|count\s*-\s*1/i, path);
  }
  // No invented mark-read endpoint anywhere.
  const service = await read("../services/notificationInbox.ts");
  assert.doesNotMatch(service, /method:\s*"(POST|PATCH|PUT|DELETE)"/);
});

test("Retry and pull-to-refresh force reads; a background re-read keeps what is shown", async () => {
  const screen = await read("../app/notifications.tsx");
  assert.match(screen, /const force = mode === "retry" \|\| mode === "refresh";/);
  assert.match(screen, /action=\{\{ label: i18n\.t\("common\.retry"\), onPress: \(\) => void load\("retry"\) \}\}/);
  assert.match(screen, /refreshControl=\{<RefreshControl refreshing=\{refreshing\} onRefresh=\{refresh\} \/>\}/);
  assert.match(screen, /if \(listCurrent\(\) && mode !== "revalidate"\) \{\s*setErrorReason\(failureReason\(err\)\);\s*setError\(true\);/);
  // The backend's reason is shown when it gave one.
  assert.match(screen, /message=\{errorReason \?\? i18n\.t\("notifications\.error\.message"\)\}/);
});

test("only a match target is pressable; other notifications are plain rows", async () => {
  const screen = await read("../app/notifications.tsx");
  assert.match(screen, /const matchId = notificationMatchTarget\(item\);/);
  assert.match(screen, /if \(!matchId\) \{[\s\S]*?<View style=\{rowStyle\} accessible accessibilityLabel=\{label\}>/);
  assert.match(screen, /router\.push\(\{ pathname: "\/match\/\[id\]", params: \{ id: matchId \} \}\)/);
});

test("Home's pull-to-refresh forces the unread count; the bell opens the inbox", async () => {
  const home = await read("../components/HomeFeed.tsx");
  assert.match(home, /void notifications\.reload\(\);/);
  assert.match(home, /<BrandHeader unreadCount=\{notifications\.count\} \/>/);
  const hook = await read("../hooks/useUnreadNotificationCount.ts");
  assert.match(hook, /const reload = useCallback\(\(\) => load\(true\), \[load\]\);/);
  assert.match(hook, /onUserScopedCacheInvalidated\(\(\) => \{\s*request\.invalidate\(\);\s*setCount\(null\);/);
  const header = await read("../components/TabHeader.tsx");
  assert.match(header, /onPress=\{\(\) => router\.push\("\/notifications"\)\}/);
});
