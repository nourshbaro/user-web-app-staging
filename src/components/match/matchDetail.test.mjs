import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
// Comments may describe forbidden things; contracts apply to code only.
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const route = strip(await read("../../app/match/[id].tsx"));
const hero = strip(await read("./MatchDetailHero.tsx"));
const options = strip(await read("./TicketOptions.tsx"));
const seats = strip(await read("./SeatSelection.tsx"));
const selection = strip(await read("../../lib/ticketSelection.ts"));

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `section ${start} not found`);
  return source.slice(from, to);
}

test("the hero renders backend match fields through the shared Phase 2 labels", () => {
  assert.match(hero, /matchLabels\(match, i18n\)/);
  assert.match(hero, /<TeamCrest team=\{team\}/);
  assert.match(hero, /<StatusBadge label=\{labels\.statusLabel\} tone=\{labels\.statusTone\}/);
  // No second status mapping or kickoff parser, and no fabricated match facts.
  assert.doesNotMatch(hero, /matchStatusPresentation|new Date|Date\.parse|formatTime|formatCalendarDate/);
  assert.doesNotMatch(hero, /score|attendance|competition|favou?rite|soldOut|sold out/i);
  assert.doesNotMatch(hero, /matchesService|useCart|useState|useEffect|router\./);
});

test("ticket option and seat components are presentation-only", () => {
  for (const [name, source] of [["TicketOptions", options], ["SeatSelection", seats]]) {
    assert.doesNotMatch(source, /matchesService|apiRequest|useCart|CartContext|useState|useEffect|router\.|storage/, name);
  }
  assert.doesNotMatch(selection, /^import (?!type)/m, "ticketSelection must stay a pure module");
});

test("GA quantity controls are named, expose the quantity, and use semantic disabled state", () => {
  const stepper = section(options, "export function GaZoneStepper", "export function ReservedZoneStatus");
  assert.match(stepper, /tickets\.stepper\.decrease/);
  assert.match(stepper, /tickets\.stepper\.increase/);
  assert.match(stepper, /accessibilityLabel=\{i18n\.plural\("tickets\.stepper\.value", quantity\)\}/);
  assert.match(stepper, /const minusDisabled = disabled \|\| quantity <= 0/);
  assert.match(stepper, /aria-disabled=\{minusDisabled\}/);
  assert.match(stepper, /aria-disabled=\{disabled\}/);
  assert.match(route, /<GaZoneStepper[\s\S]{0,240}disabled=\{isCommitting\}/);
});

test("zone cards expose selection to native and web; reserved cards are one button, GA cards never nest the stepper", () => {
  const card = section(options, "export function ZoneOptionCard", "export function GaZoneStepper");
  assert.equal((card.match(/aria-selected=\{selected\}/g) ?? []).length, 2);
  assert.match(route, /pressTarget=\{zone\.has_seats \? "card" : "details"\}/);
});

test("the only cart mutations go through the verified confirmation, via CartContext", () => {
  const mutations = route.match(/cart\.(addItem|updateItem|removeItem|removeItems)\(/g) ?? [];
  assert.deepEqual(mutations, ["cart.addItem(", "cart.updateItem(", "cart.removeItem(", "cart.addItem("]);
  const commit = section(route, "const commitSelections = async", "const reconcileCart");
  // Phase 4 corrections: the gate is the shared CartContext one, read synchronously.
  assert.match(commit, /if \(!ensureAuthenticated\(\)\) return;\s*if \(isCommitting \|\| isReconciling \|\| cart\.isCartReconciliationRequired\(\)\) return;\s*if \(!preflight\.canConfirm\) return;/);
  assert.match(route, /const needsCartReconcile = reconciliationActive\(cart\.cartReconciliation, cart\.sessionId\);/);
  assert.doesNotMatch(route, /const \[needsCartReconcile/, "no screen-local gate");
  assert.doesNotMatch(route, /setNeedsCartReconcile/);
  assert.match(commit, /const outcome = await executeSelectionCommit\(plan, \{/);
  assert.match(commit, /stadium_zone_id: zoneId,\s*quantity,/);
  assert.match(commit, /setZone: \(lockKey, quantity\) => cart\.updateItem\(lockKey, quantity\)/);
  assert.match(commit, /removeLine: \(lockKey\) => cart\.removeItem\(lockKey\)/);
  assert.match(commit, /seat_ids: \[\.\.\.seatIds\]/);
  assert.match(commit, /seatIds: seatDraft\.actionableIds/, "only revalidated seats are sent");
  assert.match(commit, /currentSessionId: \(\) => cart\.captureCartSession\(\)\?\.sessionId \?\? null/);
  assert.doesNotMatch(commit, /Promise\.all/);
});

test("drafts clear, success shows and Cart opens only on a confirmed outcome", () => {
  const commit = section(route, "const commitSelections = async", "const reconcileCart");
  const success = section(commit, "if (effects.success) {", "return;");
  for (const effect of ["setDraftQuantities(new Map())", "setSelectedSeats([])", "selection.done.title", 'router.navigate("/cart")']) {
    assert.ok(success.includes(effect), effect);
  }
  const afterSuccess = commit.slice(commit.indexOf("return;", commit.indexOf("if (effects.success) {")));
  assert.doesNotMatch(afterSuccess, /setDraftQuantities|setSelectedSeats\(|selection\.done|router\./);
  assert.match(afterSuccess, /if \(effects\.needsReconcile\) cart\.requireCartReconciliation\("unconfirmed-mutation"\)/);
  assert.match(afterSuccess, /selection\.unconfirmed\.message/);
});

test("reconciliation re-reads the cart through its owner and only a confirmed read unblocks", () => {
  const reconcile = section(route, "const reconcileCart = async", "const toggleSeat");
  // The owner releases the shared gate itself, only for a confirmed read of that session.
  assert.match(reconcile, /const result = await cart\.refreshCart\(\);\s*if \(result\.confirmed\) return;/);
  assert.doesNotMatch(reconcile, /cart\.(addItem|updateItem|removeItem)/);
});

test("draft selection stays local: no second cart or persistence", () => {
  assert.doesNotMatch(route, /storage\.|AsyncStorage|SecureStore|localStorage/);
  assert.doesNotMatch(route, /useState<[^>]*CartItem/);
  assert.doesNotMatch(route, /createContext|zustand/);
  assert.match(route, /cartLinesByZone\(cart\.items, String\(id \?\? ""\)\)/);
  assert.match(route, /cartSeatIdsForZone\(cart\.items, String\(id \?\? ""\), selectedZone\?\.id\)/);
});

test("the transaction bar is fed by the screen and the confirmation stays single", () => {
  assert.match(route, /onPress: needsCartReconcile\s*\? \(\) => void reconcileCart\(\)\s*: \(\) => void commitSelections\(\)/);
  assert.match(route, /disabled: actionDisabled/);
  assert.match(route, /!needsCartReconcile && auth\.isAuthenticated && !preflight\.canConfirm/);
  assert.match(route, /busy: isCommitting \|\| isReconciling/);
  assert.equal((route.match(/commitSelections\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(route, /addSelectedSeatsToCart/);
});

test("every seat count, price, summary and payload uses the revalidated draft", () => {
  assert.match(route, /const currentSeatSnapshot =\s*seatSnapshotLoaded && !seatLoading && !visibleSeatError\s*\? visibleSeats\s*: null;/);
  assert.match(route, /actionableSeatDraft\(\{\s*draftIds: effectiveSelectedSeats,\s*currentSeats: currentSeatSnapshot,\s*cartSeatIds,/);
  const render = route.slice(route.indexOf("const estimate = selectionEstimate"));
  assert.doesNotMatch(render.slice(0, render.indexOf("function errorFacts")), /effectiveSelectedSeats/);
});

test("seat loading keeps its request authority, identity-owned errors, and cart exclusions", () => {
  assert.match(route, /seatRequestAuthority\.begin\(requestIdentity\)/);
  assert.match(route, /seatRequestAuthority\.invalidate\(activeSeatIdentity\)/);
  assert.equal((route.match(/if \(!seatRequestAuthority\.isCurrent\(ticket, activeSeatIdentity\)\)/g) ?? []).length, 4);
  assert.match(route, /setSeatError\(\{ identity: requestIdentity, kind \}\)/);
  assert.match(route, /seatError\?\.identity === activeSeatIdentity/);
  assert.match(route, /seatSnapshot\?\.identity === activeSeatIdentity \? seatSnapshot\.seats : \[\]/);
  assert.match(route, /if \(!sameZone\) seatRequestAuthority\.invalidate\(\);/);
  assert.match(route, /getEffectiveSelectedSeats\(\s*selectedSeats,\s*selectedSeatsIdentity,\s*activeZoneIdentity,\s*cartSeatIds,/);
  assert.match(route, /toggleDraftSeat\(\s*current,\s*seat,\s*selectedSeatsIdentity === activeZoneIdentity,\s*cartSeatIds,/);
});

test("seats are named from real metadata and unavailable seats are not actionable", () => {
  const seatMap = section(route, "function SeatMap(", "function useMatchStyles");
  assert.match(seatMap, /getSeatAccessibility\(\{/);
  assert.match(seatMap, /const inactive = accessibility\.disabled \|\| disabled;/);
  assert.match(seatMap, /disabled=\{inactive\}/);
  assert.match(seatMap, /aria-selected=\{accessibility\.selected\}/);
  assert.match(seatMap, /aria-disabled=\{inactive\}/);
  // Shape/fill per state, not colour alone.
  assert.match(seatMap, /seatGlyphStyle\(state, theme\.colors, seatSize\)/);
  assert.match(seats, /case "unavailable":[\s\S]{0,120}backgroundColor: "transparent"/);
  assert.match(seats, /case "inCart":[\s\S]{0,80}borderRadius: seatSize \* 0\.22/);
});

test("seat press targets are sized from real spacing and centred on the unchanged glyph", () => {
  const seatMap = section(route, "function SeatMap(", "function useMatchStyles");
  assert.match(seatMap, /seatTouchTarget\(layout\.seats, zoom, seatSize\)/);
  assert.match(seatMap, /width: target\.size,\s*height: target\.size,/);
  assert.match(seatMap, /left: offsetX \+ seat\.px \* zoom \+ \(seatSize - target\.size\) \/ 2/);
  assert.match(seatMap, /pointerEvents="none"\s*style=\{\[local\.seatGlyph, seatGlyphStyle\(state, theme\.colors, seatSize\)\]\}/);
  assert.doesNotMatch(seatMap, /hitSlop/, "no overlapping hit slop");
  assert.match(seatMap, /!target\.meetsRecommended \?[\s\S]{0,120}seats\.zoomHint/);
});

test("zoom scales real coordinates uniformly and never rewrites geometry", () => {
  const seatMap = section(route, "function SeatMap(", "function useMatchStyles");
  assert.match(seatMap, /createSeatLayout\(seats, size\)/);
  assert.match(seatMap, /left: offsetX \+ seat\.px \* zoom/);
  assert.match(seatMap, /top: seat\.py \* zoom/);
  assert.match(route, /getPolygonPointsAttribute\(zone\)/);
});

test("errors are shown from the catalog, never the backend's own wording", () => {
  assert.doesNotMatch(route, /userFacingError|backendProvidedError|backendResponseMessage|err\.message|error\.message/);
  assert.match(route, /ticketErrorKind\("match", errorFacts\(err\)\)/);
  assert.match(route, /ticketErrorKind\("seats", errorFacts\(err\)\)/);
  assert.match(route, /ticketErrorKind\("cart", errorFacts\(outcome\.error\)\)/);
  assert.match(route, /onPress: \(\) => void loadMatch\(\)/, "match retry goes through the existing loader");
  assert.match(route, /onPress: \(\) => setSeatRetryNonce/, "seat retry re-runs the guarded seat load");
});

test("no fake ticket, QR or reservation data enters Match Details", () => {
  for (const source of [route, hero, options, seats, selection]) {
    assert.doesNotMatch(source, /Math\.random|qrCells|qr_image|QRCode|mock|setTimeout\([^)]*\d{3,}/);
  }
});

test("the web stadium map stays physical and hidden from assistive tech", () => {
  const map = section(route, "function ZoneMap(", "function compactZoneName");
  assert.match(map, /dir: "ltr"/);
  assert.match(map, /direction: "ltr"/);
  assert.match(map, /"aria-hidden": true/);
});
