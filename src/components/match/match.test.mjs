import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Source-level contracts (no React renderer in this node:test setup).
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const card = await read("./MatchCard.tsx");
const featured = await read("./FeaturedMatchCard.tsx");
const crest = await read("./TeamCrest.tsx");
const skeletons = await read("./MatchSkeletons.tsx");
const home = await read("../HomeFeed.tsx");
const list = await read("../MatchesList.tsx");
const hook = await read("../../hooks/useScheduledMatches.ts");
const ui = await read("../ui.tsx");
const homeRoute = await read("../../app/index.tsx");
const matchesRoute = await read("../../app/matches.tsx");

test("match cards only render: no fetching, routing, cart, or owned state", () => {
  for (const [name, source] of [["MatchCard", card], ["FeaturedMatchCard", featured]]) {
    const code = strip(source);
    assert.doesNotMatch(code, /matchesService|apiRequest|useScheduledMatches|router\.|useCart|useState|useEffect/, name);
    assert.match(code, /onPress=\{onPress\}/, name);
  }
});

test("each card is one named button with a hint; its CTA is visual, not a nested button", () => {
  for (const [name, source] of [["MatchCard", card], ["FeaturedMatchCard", featured]]) {
    const code = strip(source);
    assert.equal(code.match(/<Pressable/g)?.length, 1, `${name} has exactly one press target`);
    assert.match(code, /accessibilityRole="button"/, name);
    assert.match(code, /accessibilityHint=\{i18n\.t\("match\.openHint"\)\}/, name);
  }
  assert.match(card, /accessibilityLabel=\{i18n\.t\("match\.a11y"/);
  assert.match(featured, /accessibilityLabel=\{i18n\.t\("match\.featured\.a11y"/);
});

test("cards use backend fields through shared labels, semantic tokens and direction-aware chevrons", () => {
  const labels = [card, featured].join("\n");
  assert.match(labels, /matchLabels\(match, i18n\)/);
  assert.match(labels, /<DirectionalChevron kind="forward"/);
  assert.doesNotMatch(labels, /theme\.colors\.(muted|ink|primary|panel|line)\b/, "no legacy colour roles in redesigned cards");
  assert.doesNotMatch(labels, /#[0-9A-Fa-f]{3,8}\b/, "no hard-coded colours");
  assert.doesNotMatch(labels, /live|score|result|sold out/i);
});

test("card entrance motion respects the OS reduce-motion setting", () => {
  assert.match(card, /entering=\{FadeInDown\.duration\(\d+\)\.reduceMotion\(ReduceMotion\.System\)\}/);
  assert.doesNotMatch(card, /withRepeat|Animated\.loop/);
});

test("crests are decorative with a production-safe initials fallback", () => {
  assert.match(crest, /importantForAccessibility="no-hide-descendants"/);
  assert.match(crest, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(crest, /teamInitials\(team\)/);
  assert.match(crest, /storageUrl\(team\?\.logo\)/);
});

test("list skeletons are one announced loading element shaped like the cards", () => {
  assert.match(skeletons, /<SkeletonGroup label=\{label\}>/);
  assert.match(skeletons, /withFeatured \? <FeaturedMatchSkeleton \/> : null/);
});

test("the scheduled-matches owner keeps the existing service, cache and stale-response guard", () => {
  assert.match(hook, /matchesService\.list\(requestFilters, forceRefresh\)/);
  assert.match(hook, /matchesService\.filters\(forceRefresh\)/);
  assert.match(hook, /requestAuthority\.begin\(/);
  assert.match(hook, /if \(!requestAuthority\.isCurrent\(ticket\)\) return;/);
  assert.match(hook, /requestAuthority\.invalidate\(filterIdentity\)/);
  assert.match(hook, /const refresh = useCallback\(\(\) => \{\s*setRefreshing\(true\);\s*void load\(true\);/);
});

test("Home: banner, featured next match by a transparent rule, upcoming list, and honest states", () => {
  assert.match(homeRoute, /<HomeFeed \/>/);
  assert.match(home, /<AppBanner \/>/);
  assert.match(home, /const now = useKickoffClock\(data\.matches, data\.loadedAt\);/);
  assert.match(home, /selectHomeMatches\(data\.matches, now, HOME_MATCH_LIMIT\)/);
  assert.doesNotMatch(strip(home), /Date\.now\(\)/, "no clock reads during render");
  assert.match(hook, /setLoadedAt\(Date\.now\(\)\);/);
  // Matches exist but none is upcoming: an honest panel, never a past fixture as "Next match".
  assert.match(home, /title=\{t\("home\.noUpcoming\.title"\)\}/);
  assert.match(home, /const HOME_MATCH_LIMIT = 5;/);
  assert.match(home, /\{featured \? \(?\s*<FeaturedMatchCard match=\{featured\}/);
  assert.match(home, /<MatchListSkeleton[^>]*withFeatured/);
  assert.match(home, /variant="error"[\s\S]*?action=\{\{ label: t\("common\.retry"\), onPress: data\.retry \}\}/);
  assert.match(home, /variant="empty" title=\{t\("matches\.empty\.title"\)\}/);
  assert.match(home, /refreshControl=\{<RefreshControl refreshing=\{data\.refreshing\} onRefresh=\{data\.refresh\} \/>\}/);
});

test("Home's 'All matches' switches tabs with the same replace semantics as the tab bar", () => {
  const open = home.slice(home.indexOf("const openAllMatches"), home.indexOf("return (", home.indexOf("const openAllMatches")));
  assert.match(open, /setPrimaryTabTransitionDirection\(1\);/);
  assert.match(open, /router\.replace\("\/matches"\);/);
  assert.doesNotMatch(open, /router\.push/);
});

test("Matches distinguishes filtered-empty (with Clear) from globally empty, and errors (with Retry)", () => {
  assert.match(matchesRoute, /<MatchesList \/>/);
  assert.match(list, /state === "filtered-empty"[\s\S]*?title=\{t\("matches\.filteredEmpty\.title"\)\}[\s\S]*?action=\{\{ label: t\("filters\.clear"\), onPress: clearFilters \}\}/);
  assert.match(list, /state === "empty"[\s\S]*?title=\{t\("matches\.empty\.title"\)\}/);
  assert.match(list, /state === "error"[\s\S]*?action=\{\{ label: t\("common\.retry"\), onPress: data\.retry \}\}/);
  assert.match(list, /state === "loading"[\s\S]*?<MatchListSkeleton/);
});

test("opening a match keeps the existing route and push semantics", () => {
  assert.match(list, /router\.push\(\{ pathname: "\/match\/\[id\]", params: \{ id: String\(match\.id\) \} \}\)/);
});

test("bottom navigation shows visible labels with a non-colour selected indicator", () => {
  const nav = ui.slice(ui.indexOf("function BottomNavigation"), ui.indexOf("export function useResponsive"));
  assert.match(nav, /<Text\s+numberOfLines=\{1\}[\s\S]*?maxFontSizeMultiplier=\{1\.3\}[\s\S]*?>\s*\{label\}\s*<\/Text>/);
  assert.match(nav, /active && \{ backgroundColor: theme\.colors\.selectedSurface \}/);
  // Selected also reads heavier (semantic font helper), never colour alone.
  assert.match(nav, /fontStyleFor\("text", active \? "700" : "500", meta\.script\)/);
  assert.match(nav, /aria-selected=\{active\}/);
  assert.match(nav, /onNavigate\(tab\.href\);/);
  assert.match(ui, /bottomNavItem: \{[\s\S]*?minHeight: size\.touchTarget/);
});

test("tab swipe and entrance motion are RTL-aware and entrance honours reduced motion", () => {
  assert.match(ui, /navigateAdjacent\(swipeTabStep\(translationX, isRTL\)\)/);
  assert.match(ui, /tabEntranceOffset\(getPrimaryTabTransitionDirection\(\), isRTL\)/);
  assert.match(ui, /if \(!hasBottomNavigation \|\| reducedMotion\) \{\s*entrance\.setValue\(1\);/);
});

test("featured aging: one boundary timer plus foreground re-evaluation, never a refetch or poll", async () => {
  const clock = await read("../../hooks/useKickoffClock.ts");
  const code = strip(clock);
  assert.match(code, /nextKickoffAfter\(matches, now\)/);
  assert.match(code, /setTimeout\(\(\) => setTick\(Date\.now\(\)\), delay\)/);
  assert.match(code, /return \(\) => clearTimeout\(timer\);/);
  assert.match(code, /AppState\.addEventListener\("change"/);
  assert.match(code, /if \(state === "active"\) setTick\(Date\.now\(\)\);/);
  assert.doesNotMatch(code, /setInterval|matchesService|useScheduledMatches|load\(|refresh\(/);
});

test("filter changes invalidate the in-flight request synchronously, before state changes", () => {
  const change = list.slice(list.indexOf("const changeFilters"), list.indexOf("const clearFilters"));
  assert.ok(change.indexOf("invalidate(next);") >= 0);
  assert.ok(change.indexOf("invalidate(next);") < change.indexOf("setFilters(next);"));
  assert.match(list, /const clearFilters = useCallback\(\(\) => changeFilters\(\{\}\), \[changeFilters\]\);/);
  assert.doesNotMatch(list, /onChange=\{setFilters\}/);
  assert.match(hook, /const invalidate = useCallback\(\(nextFilters: MatchFilters\) => \{\s*requestAuthority\.invalidate\(matchFilterIdentity\(nextFilters\)\);/);
});

test("the hook only returns results/errors tagged with the current filter identity", () => {
  assert.match(hook, /setSnapshot\(applyQuerySuccess\(identity, nextMatches\)\)/);
  assert.match(hook, /setSnapshot\(\(current\) => applyQueryFailure\(current, identity, message\)\)/);
  assert.match(hook, /const view = matchQueryView\(snapshot, filterIdentity\);/);
  assert.match(hook, /matches: view\.items,/);
  assert.match(hook, /const loading = loadingFlag \|\| \(!view\.hasItemsForSelection && view\.error === null\);/);
});

test("the filter sheet's final action says what it does (filters apply immediately)", async () => {
  const catalog = await read("../../i18n/messages/en.ts");
  assert.match(catalog, /"filters\.done": "Done",/);
  assert.match(catalog, /"match\.status\.unknown": "Status unavailable",/);
});
