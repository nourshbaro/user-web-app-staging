import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const ui = await read("../ui.tsx");
const transactionBar = await read("./TransactionBar.tsx");
const ticketCard = await read("./TicketCard.tsx");
const statusBadge = await read("./StatusBadge.tsx");
const statePanel = await read("./StatePanel.tsx");
const skeleton = await read("./Skeleton.tsx");
const direction = await read("./direction.tsx");
const appText = await read("./AppText.tsx");
const appTextBase = await read("./appTextStyle.ts");
const matchDetail = await read("../../app/match/[id].tsx");
const layout = await read("../../app/_layout.tsx");

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `section ${start} not found`);
  return source.slice(from, to);
}

test("Button exposes role, label, disabled and busy state", () => {
  const button = section(ui, "export function Button(", "export const Input");
  assert.match(button, /accessibilityRole="button"/);
  assert.match(button, /accessibilityLabel=\{accessibilityLabel \?\? title\}/);
  // aria-* (not accessibilityState) so state also reaches the DOM on react-native-web.
  assert.match(button, /aria-disabled=\{inactive\}/);
  assert.match(button, /aria-busy=\{loading\}/);
  assert.doesNotMatch(button, /accessibilityState=/);
  assert.match(button, /disabled=\{inactive\}/);
  assert.match(button, /const inactive = Boolean\(disabled \|\| loading\)/);
  assert.match(ui, /button: \{\s*minHeight: size\.controlHeight/);
});

test("Input names the field with its visible label unless the caller overrides it", () => {
  const input = section(ui, "export const Input", "export function Empty");
  assert.match(input, /<Text nativeID=\{labelId\}/);
  const labelIndex = input.indexOf("accessibilityLabel={label}");
  const spreadIndex = input.indexOf("{...props}");
  assert.ok(labelIndex >= 0 && spreadIndex > labelIndex, "caller props must be able to override the default label");
});

test("Loading is a single labeled busy progress element", () => {
  const loading = section(ui, "export function Loading(", "function BottomNavigation");
  assert.match(loading, /accessibilityRole="progressbar"/);
  assert.match(loading, /accessibilityLabel=\{label \?\? t\("common\.loading"\)\}/);
  assert.match(loading, /aria-busy\b/);
  assert.doesNotMatch(loading, /accessibilityLiveRegion/);
});

test("bottom navigation exposes tablist/tab semantics with selected state", () => {
  const nav = section(ui, "function BottomNavigation", "export function useResponsive");
  assert.match(nav, /accessibilityRole="tablist"/);
  assert.match(nav, /accessibilityRole="tab"/);
  assert.match(nav, /aria-selected=\{active\}/);
  assert.match(nav, /accessibilityLabel=\{label\}/);
});

test("TransactionBar is presentation-only and owns no transaction state", () => {
  assert.doesNotMatch(transactionBar, /useCart|CartContext|checkoutService|cartService|useTicketHolders|useState|storage/);
  assert.match(transactionBar, /loading=\{primaryAction\.busy\}/);
  assert.match(transactionBar, /disabled=\{primaryAction\.disabled\}/);
});

test("ticket foundation never generates QR data and keeps the QR frame unmirrored", () => {
  assert.doesNotMatch(ticketCard, /qrcode|QRCode|qr_image|profileService|Math\.random/);
  assert.match(ticketCard, /<PhysicalLayout style=/);
  assert.match(ticketCard, /scanSurface/);
});

test("status presentation does not interpret backend statuses", () => {
  assert.doesNotMatch(statusBadge, /"valid"|"expired"|"live"\s*:|status ===/);
  assert.match(statusBadge, /theme\.colors\.tones\[tone\]/);
});

test("state panels leave fetching to the owning screen", () => {
  assert.doesNotMatch(statePanel, /apiRequest|Service\.|useEffect/);
});

test("state panel errors have exactly one polite announcement owner and no assertive alert", () => {
  // Limitation: no renderer is available in this node:test setup, so this is a source contract (comments stripped).
  const code = statePanel.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(code.match(/accessibilityLiveRegion=/g)?.length, 1);
  assert.match(code, /accessibilityLiveRegion=\{variant === "error" \? "polite" : "none"\}/);
  assert.doesNotMatch(code, /"alert"|role="alert"|aria-live/);
  assert.doesNotMatch(code, /announceForAccessibility/);
});

test("skeletons honor reduced motion and group into one loading element", () => {
  assert.match(skeleton, /useReducedMotion\(\)/);
  assert.match(skeleton, /if \(reducedMotion\) \{\s*pulse\.setValue\(0\);\s*return;/);
  assert.match(skeleton, /accessibilityRole="progressbar"/);
  assert.match(skeleton, /aria-busy\b/);
  assert.doesNotMatch(skeleton, /setTimeout/);
});

test("text alignment is natural (no hard-coded left/right) in the typography primitive", () => {
  // The base style lives in the pure appTextStyle helper (diff-safe; see filterChipCrash.test).
  assert.match(appTextBase, /textAlign: align === "center" \? \("center" as const\) : \("auto" as const\)/);
  assert.doesNotMatch(appText + appTextBase, /textAlign: "(left|right)"/);
  assert.match(appText, /appTextBaseStyle\(\{/);
  assert.match(direction, /PHYSICAL_LAYOUT_STYLE/);
});

test("stadium map and seat map geometry are pinned LTR", () => {
  assert.match(matchDetail, /mapFrame: \{[\s\S]{0,80}\.\.\.PHYSICAL_LAYOUT_STYLE/);
  assert.match(matchDetail, /seatMapFrame: \{[\s\S]{0,80}\.\.\.PHYSICAL_LAYOUT_STYLE/);
  assert.match(matchDetail, /seatMapScroll: \{ \.\.\.PHYSICAL_LAYOUT_STYLE/);
});

test("the app waits for the locale before rendering, above the theme", () => {
  assert.match(layout, /<I18nProvider>\s*<ThemeProvider>/);
  assert.match(layout, /const isReady = auth\.isReady && i18n\.isReady;/);
});

test("reading-direction arrows go through DirectionalChevron, never a fixed left/right glyph", async () => {
  const { readdir } = await import("node:fs/promises");
  const walk = async (dir) => {
    const files = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) files.push(...(await walk(url)));
      else if (entry.name.endsWith(".tsx")) files.push(url);
    }
    return files;
  };
  const offenders = [];
  for (const url of await walk(new URL("../../", import.meta.url))) {
    if (url.pathname.endsWith("/foundation/direction.tsx")) continue;
    const source = await readFile(url, "utf8");
    // A physical chevron does not mirror in RTL; forward/back must use DirectionalChevron.
    if (/"chevron\.(left|right)"|"chevron_(left|right)"/.test(source)) offenders.push(url.pathname.split("/src/")[1]);
  }
  assert.deepEqual(offenders, [], "use DirectionalChevron for forward/back and disclosure arrows");
});
