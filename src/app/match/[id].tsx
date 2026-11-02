import { FlowHeader } from "@/components/FlowHeader";
import {
  AppText,
  PhysicalLayout,
  SkeletonBlock,
  SkeletonGroup,
  StatePanel,
  TransactionBar,
} from "@/components/foundation";
import { MatchDetailHero } from "@/components/match/MatchDetailHero";
import { MatchInfoView } from "@/components/match/MatchInfoView";
import { MatchDetailSkeleton } from "@/components/match/MatchSkeletons";
import {
  PitchBar,
  SeatLegend,
  SeatZoomControls,
  SelectedSeatChips,
  SelectedSeatMark,
  seatGlyphStyle,
} from "@/components/match/SeatSelection";
import {
  GaZoneStepper,
  ZoneList,
  ZoneRow,
} from "@/components/match/TicketOptions";
import { matchLabels } from "@/components/match/matchLabels";
import {
  useResponsive,
  useTheme,
  type ThemeColors,
} from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { PHYSICAL_LAYOUT_STYLE } from "@/i18n/direction";
import { useI18n } from "@/i18n/I18nProvider";
import { storageUrl } from "@/lib/config";
import { layout, radius, spacing } from "@/lib/designTokens";
import { formatMoney } from "@/lib/format";
import {
  createSeatLayout,
  getContainRect,
  getPolygonPoints,
  getPolygonPointsAttribute,
} from "@/lib/mapGeometry";
import {
  getEffectiveSelectedSeats,
  getOwnedMapHeight,
  type OwnedMapMeasurement,
} from "@/lib/matchLifecycle";
import {
  createRequestAuthority,
  createRequestIdentity,
} from "@/lib/requestAuthority";
import { reconciliationActive } from "@/lib/cartReconciliation";
import { getSeatAccessibility, getSeatIdentity } from "@/lib/seatAccessibility";
import {
  SEAT_ZOOM_LEVELS,
  actionableSeatDraft,
  cartLinesByZone,
  cartSeatIdsForZone,
  commitEffects,
  executeSelectionCommit,
  seatTouchTarget,
  selectionPreflight,
  type CommitPlan,
  gaCartChanges,
  isPurchasableMatchStatus,
  isSeatSelectable,
  matchDetailExperience,
  resolveDraftQuantity,
  seatVisualState,
  selectionActionKind,
  selectionEstimate,
  stepSeatZoom,
  ticketErrorKind,
  toggleDraftSeat,
  type TicketErrorContext,
  type TicketErrorFacts,
  type TicketErrorKind,
} from "@/lib/ticketSelection";
import { failureReason, reasonWithGuidance, userFacingError } from "@/lib/userFacingError";
import { ApiError, ApiTransportError } from "@/services/api";
import { matchesService } from "@/services/matches";
import type { ApiSeat, ApiZone, ApiMatchDetail } from "@/types";
import { Image as ExpoImage } from "expo-image";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import {
  createElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  BackHandler,
  Image,
  Text,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Polygon } from "react-native-svg";

const MAP_VIEW_W = 600;
const DEFAULT_MAP_VIEW_H = 445;
// Unscaled seat marker size and spacing used by createSeatLayout.
const SEAT_SIZE = 18;
const SEAT_LAYOUT_PADDING = 36;
// Readable single column on tablets and web; the page never stretches cards to 1180px.
const COLUMN_MAX_WIDTH = 760;
// v3 content sheet top padding (it overlaps the hero by 24pt).
const SHEET_PADDING_TOP = 22;

type I18n = ReturnType<typeof useI18n>;

export default function MatchDetail() {
  const local = useMatchStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const responsive = useResponsive();
  const theme = useTheme();
  const i18n = useI18n();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [match, setMatch] = useState<ApiMatchDetail | null>(null);
  const [matchIdentity, setMatchIdentity] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<ApiZone | null>(null);
  const [seatSnapshot, setSeatSnapshot] = useState<{
    identity: string;
    seats: ApiSeat[];
  } | null>(null);
  // Seat-load failure, owned by the request identity that produced it so a
  // stale failure never shows against another zone.
  const [seatError, setSeatError] = useState<{
    identity: string;
    kind: TicketErrorKind;
    reason: string | null;
  } | null>(null);
  // Bumped by the seat-error Retry action to re-run the guarded seat load.
  const [seatRetryNonce, setSeatRetryNonce] = useState(0);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [selectedSeatsIdentity, setSelectedSeatsIdentity] = useState<
    string | null
  >(null);
  const [selectedZoneMatchId, setSelectedZoneMatchId] = useState<string | null>(
    null,
  );
  const [stadiumFocusedZone, setStadiumFocusedZone] = useState<{
    matchId: string;
    zoneId: number;
  } | null>(null);
  // General-admission quantities the user is choosing on this screen, NOT
  // yet sent anywhere. Keyed by zone id. Zero requests happen while this
  // changes — it only becomes real when the confirmation action is pressed
  // (see commitSelections). A zone with no entry here simply mirrors
  // whatever is already committed in CartContext (see getDraftQuantity), so
  // returning to Match Details with existing cart lines shows their real
  // quantities without needing a seeding effect.
  const [draftQuantities, setDraftQuantities] = useState<Map<number, number>>(
    () => new Map(),
  );
  const [isCommitting, setIsCommitting] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  // v3: the stadium map starts collapsed; showing it is presentation only.
  const [stadiumExpanded, setStadiumExpanded] = useState(false);
  // v3 seat picker for the selected reserved zone: a view of this screen, so
  // the draft, seat snapshot and confirmation stay with this one owner.
  const [seatPickerOpen, setSeatPickerOpen] = useState(false);
  const [seatZoom, setSeatZoom] = useState<number>(SEAT_ZOOM_LEVELS[0]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seatLoading, setSeatLoading] = useState(false);
  const [errorKind, setErrorKind] = useState<TicketErrorKind | null>(null);
  // What the backend (or the transport) said about the failed match load.
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [transactionBarHeight, setTransactionBarHeight] = useState(0);
  const pageScrollRef = useRef<ScrollView>(null);
  const ticketSectionY = useRef(0);
  const zoneCardLayouts = useRef(new Map<number, number>());
  const zoneListY = useRef(0);
  const matchRequestAuthority = useMemo(() => createRequestAuthority(), []);
  const seatRequestAuthority = useMemo(() => createRequestAuthority(), []);
  const selectedZoneRef = useRef<ApiZone | null>(null);
  const selectedZoneMatchIdRef = useRef<string | null>(null);
  const auth = useAuth();
  const cart = useCart();
  // The shared CartContext gate (not screen-local): an unknown cart outcome on
  // any surface blocks this confirmation until the owner has re-read the cart,
  // so an already-applied change is never replayed.
  const needsCartReconcile = reconciliationActive(cart.cartReconciliation, cart.sessionId);
  const toast = useToast();
  const cartSeatIds = useMemo(
    () => cartSeatIdsForZone(cart.items, String(id ?? ""), selectedZone?.id),
    [cart.items, id, selectedZone?.id],
  );
  // Per-zone cart state for this match, read straight from CartContext —
  // no second quantity authority. General-admission zones resolve to a
  // single { quantity, lockKey } line (mirrors addItem's own merge logic);
  // reserved-seat zones resolve to a seat count used only for the card's
  // informational label (the seat map below remains the source of truth
  // for which seats are selected).
  const cartByZone = useMemo(
    () => cartLinesByZone(cart.items, String(id ?? "")),
    [cart.items, id],
  );
  const cartItemsSignature = useMemo(
    () =>
      cart.items
        .map(
          (item) =>
            `${item.lock_key}:${item.quantity}:${item.seat_ids?.join(",") ?? ""}`,
        )
        .join("|"),
    [cart.items],
  );
  const routeMatchId = String(id ?? "");
  const selectedZoneBelongsToMatch = selectedZoneMatchId === routeMatchId;
  const activeZoneIdentity = createRequestIdentity([
    routeMatchId,
    selectedZoneBelongsToMatch ? selectedZone?.id : null,
  ]);
  const activeSeatIdentity = createRequestIdentity([
    routeMatchId,
    selectedZoneBelongsToMatch ? selectedZone?.id : null,
    cartItemsSignature,
    selectedZoneBelongsToMatch ? selectedZone?.has_seats : false,
  ]);
  const visibleSeats =
    seatSnapshot?.identity === activeSeatIdentity ? seatSnapshot.seats : [];
  const seatSnapshotLoaded = seatSnapshot?.identity === activeSeatIdentity;
  const visibleSeatError =
    seatError?.identity === activeSeatIdentity ? seatError.kind : null;
  const visibleSeatErrorReason =
    seatError?.identity === activeSeatIdentity ? seatError.reason : null;
  const effectiveSelectedSeats = getEffectiveSelectedSeats(
    selectedSeats,
    selectedSeatsIdentity,
    activeZoneIdentity,
    cartSeatIds,
  );
  // The seat list owned by the CURRENT request identity, only once it has
  // loaded successfully. While loading or failed there is nothing to validate
  // a draft against, so no drafted seat is confirmable.
  const currentSeatSnapshot =
    seatSnapshotLoaded && !seatLoading && !visibleSeatError
      ? visibleSeats
      : null;
  const seatDraft = actionableSeatDraft({
    draftIds: effectiveSelectedSeats,
    currentSeats: currentSeatSnapshot,
    cartSeatIds,
  });
  const matchBelongsToRoute = matchIdentity === routeMatchId;
  const zones = matchBelongsToRoute ? (match?.stadium?.zones ?? []) : [];
  const mapImageUrl = storageUrl(
    matchBelongsToRoute
      ? (match?.stadium?.mapImageUrl ?? match?.stadium?.map_image)
      : undefined,
  );
  const mapViewHeight = useMapViewHeight(mapImageUrl, zones);

  const commitZone = useCallback(
    (zone: ApiZone | null, ownerMatchId: string) => {
      const sameZone =
        selectedZoneMatchIdRef.current === ownerMatchId &&
        selectedZoneRef.current?.id === zone?.id;
      const nextSelectionIdentity = createRequestIdentity([
        ownerMatchId,
        zone?.id,
      ]);

      if (!sameZone) seatRequestAuthority.invalidate();
      selectedZoneRef.current = zone;
      selectedZoneMatchIdRef.current = ownerMatchId;
      setSelectedZone(zone);
      setSelectedZoneMatchId(ownerMatchId);

      if (!sameZone) {
        setSelectedSeats([]);
        setSelectedSeatsIdentity(nextSelectionIdentity);
        setSeatSnapshot(null);
      }
    },
    [seatRequestAuthority],
  );

  // The screen's one match-status owner: every read of the backend status
  // (initial load, pull-to-refresh, the pre-commit re-check) goes through
  // here, and resolves with the fresh match (null when it failed or is stale).
  const loadMatch = useCallback(
    (force = false, quiet = false): Promise<ApiMatchDetail | null> => {
      const requestIdentity = routeMatchId;
      const ticket = matchRequestAuthority.begin(requestIdentity);
      if (!force) {
        setLoading(true);
        setMatch(null);
        setMatchIdentity(null);
      }
      setErrorKind(null);
      setErrorReason(null);
      return matchesService
        .details(requestIdentity, force)
        .then((data) => {
          if (!matchRequestAuthority.isCurrent(ticket, routeMatchId)) return;
          const currentZone =
            selectedZoneMatchIdRef.current === requestIdentity
              ? selectedZoneRef.current
              : null;
          // Zones may still be present on a live/completed match; they are
          // never selectable unless the match is scheduled (no seat loads either).
          const nextZone = !isPurchasableMatchStatus(data.status)
            ? null
            : (data.stadium?.zones?.find((zone) => zone.id === currentZone?.id) ??
              data.stadium?.zones?.[0] ??
              null);
          setMatch(data);
          setMatchIdentity(requestIdentity);
          commitZone(nextZone, requestIdentity);
          return data;
        })
        .catch((err) => {
          if (!matchRequestAuthority.isCurrent(ticket, routeMatchId)) return;
          const kind = ticketErrorKind("match", errorFacts(err));
          const reason = failureReason(err);
          setErrorKind(kind);
          setErrorReason(reason);
          // A failed pull-to-refresh keeps the match on screen, so it is
          // reported as a toast; an initial failure is shown inline instead.
          // (The pre-commit re-check reports its own outcome.)
          if (force && !quiet) {
            toast.showToast({
              variant: "error",
              title: i18n.t("matchDetail.refreshError.title"),
              message: ticketErrorMessage(i18n, "match", kind, reason),
            });
          }
        })
        .finally(() => {
          if (!matchRequestAuthority.isCurrent(ticket, routeMatchId)) return;
          setLoading(false);
          setRefreshing(false);
        })
        .then((data) => data ?? null);
    },
    [commitZone, i18n, matchRequestAuthority, routeMatchId, toast],
  );

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return loadMatch();
    });
    return () => {
      active = false;
    };
  }, [loadMatch]);

  useEffect(() => {
    matchRequestAuthority.mount();
    return () => matchRequestAuthority.unmount();
  }, [matchRequestAuthority]);

  useLayoutEffect(() => {
    matchRequestAuthority.invalidate(routeMatchId);
  }, [matchRequestAuthority, routeMatchId]);

  useEffect(() => {
    seatRequestAuthority.mount();
    return () => seatRequestAuthority.unmount();
  }, [seatRequestAuthority]);

  useLayoutEffect(() => {
    seatRequestAuthority.invalidate(activeSeatIdentity);
  }, [activeSeatIdentity, seatRequestAuthority]);

  useEffect(() => {
    const requestIdentity = activeSeatIdentity;
    const ticket = seatRequestAuthority.begin(requestIdentity);
    const requestedMatchId = routeMatchId;
    const requestedZoneId = selectedZoneBelongsToMatch
      ? selectedZone?.id
      : null;
    const requestedHasSeats =
      selectedZoneBelongsToMatch && Boolean(selectedZone?.has_seats);

    const timeout = setTimeout(() => {
      if (!seatRequestAuthority.isCurrent(ticket, activeSeatIdentity)) return;
      if (
        requestedZoneId === null ||
        requestedZoneId === undefined ||
        !requestedHasSeats
      ) {
        setSeatLoading(false);
        return;
      }

      setSeatLoading(true);
      setSeatError(null);
      void matchesService
        .seats(requestedMatchId, requestedZoneId)
        .then((data) => {
          if (!seatRequestAuthority.isCurrent(ticket, activeSeatIdentity))
            return;
          setSeatSnapshot({ identity: requestIdentity, seats: data.seats });
        })
        .catch((err) => {
          if (!seatRequestAuthority.isCurrent(ticket, activeSeatIdentity))
            return;
          const kind = ticketErrorKind("seats", errorFacts(err));
          const reason = failureReason(err);
          setSeatError({ identity: requestIdentity, kind, reason });
          AccessibilityInfo.announceForAccessibility(
            `${i18n.t("seats.error.title")}. ${ticketErrorMessage(i18n, "seats", kind, reason)}`,
          );
        })
        .finally(() => {
          if (!seatRequestAuthority.isCurrent(ticket, activeSeatIdentity))
            return;
          setSeatLoading(false);
        });
    }, 0);

    return () => clearTimeout(timeout);
  }, [
    activeSeatIdentity,
    i18n,
    routeMatchId,
    seatRequestAuthority,
    seatRetryNonce,
    selectedZone?.has_seats,
    selectedZone?.id,
    selectedZoneBelongsToMatch,
  ]);

  useEffect(() => {
    if (!seatPickerOpen) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setSeatPickerOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [seatPickerOpen]);

  const handleBack = () => {
    if (effectiveSelectedSeats.length) {
      setSelectedSeats([]);
      setSelectedSeatsIdentity(activeZoneIdentity);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  // Returns false (and redirects) for a signed-out user. The screen stays
  // mounted beneath the auth route, so the draft selection survives sign-in.
  const ensureAuthenticated = () => {
    if (auth.isAuthenticated) return true;
    router.push({
      pathname: "/auth",
      params: { returnTo: `/match/${encodeURIComponent(routeMatchId)}` },
    });
    return false;
  };

  // Pure local draft edit — no request, no CartContext mutation. A zone
  // with no draft entry falls back to its committed cart quantity (see
  // resolveDraftQuantity), so this only needs to record zones the user
  // has actually touched.
  const getDraftQuantity = (zoneId: number) =>
    resolveDraftQuantity(draftQuantities, cartByZone, zoneId);

  const setDraftQuantity = (zoneId: number, quantity: number) => {
    setDraftQuantities((current) => {
      const next = new Map(current);
      next.set(zoneId, Math.max(0, quantity));
      return next;
    });
  };

  const incrementGaDraft = (zone: ApiZone) => {
    commitZone(zone, routeMatchId);
    setStadiumFocusedZone(null);
    setDraftQuantity(zone.id, getDraftQuantity(zone.id) + 1);
  };

  const decrementGaDraft = (zone: ApiZone) => {
    setStadiumFocusedZone(null);
    setDraftQuantity(zone.id, getDraftQuantity(zone.id) - 1);
  };

  // Draft vs committed: which GA zones differ from CartContext right now.
  // Recomputed from the owner's items on every render, so after a partial
  // success the already-applied zones drop out of the next confirmation.
  const gaChanges = gaCartChanges(zones, getDraftQuantity, cartByZone);
  const preflight = selectionPreflight(gaChanges, seatDraft);

  // The one explicit confirmation action for this screen. Preflight runs
  // before the first cart mutation (a reserved-seat draft must be valid
  // against the current seat snapshot). Then each change goes through
  // CartContext one awaited call at a time — addItem for a new GA line,
  // updateItem to *set* an existing line (never addItem's additive merge),
  // removeItem for zero, then the confirmable seats as one addItem — because
  // CartContext's addItem single-flight would otherwise drop a concurrent
  // call. A resolved call is not success: success needs the cart CartContext
  // actually published, for the current session, to reflect every change.
  const commitSelections = async () => {
    if (!ensureAuthenticated()) return;
    if (isCommitting || isReconciling || cart.isCartReconciliationRequired()) return;
    if (!preflight.canConfirm) return;
    const plan: CommitPlan = {
      matchId: routeMatchId,
      gaChanges,
      seats:
        selectedZone?.has_seats && seatDraft.actionableIds.length
          ? { zoneId: selectedZone.id, seatIds: seatDraft.actionableIds }
          : null,
    };
    setIsCommitting(true);
    try {
      const outcome = await executeSelectionCommit(plan, {
        addZone: (zoneId, quantity) =>
          cart.addItem({
            match_id: Number(id),
            stadium_zone_id: zoneId,
            quantity,
          }),
        setZone: (lockKey, quantity) => cart.updateItem(lockKey, quantity),
        removeLine: (lockKey) => cart.removeItem(lockKey),
        addSeats: (zoneId, seatIds) =>
          cart.addItem({
            match_id: Number(id),
            stadium_zone_id: zoneId,
            seat_ids: [...seatIds],
          }),
        currentSessionId: () => cart.captureCartSession()?.sessionId ?? null,
        // Re-read the match now: only a still-scheduled match may reach the cart.
        confirmStillOnSale: async () => {
          const current = await loadMatch(true, true);
          if (!current) throw new Error("Match status could not be verified.");
          return isPurchasableMatchStatus(current.status);
        },
      });
      const failureKind =
        outcome.status === "failed"
          ? ticketErrorKind("cart", errorFacts(outcome.error))
          : null;
      const effects = commitEffects(outcome, failureKind);

      if (effects.success) {
        setSeatPickerOpen(false);
        setSelectedSeats([]);
        setSelectedSeatsIdentity(activeZoneIdentity);
        setDraftQuantities(new Map());
        toast.showToast({
          variant: "success",
          title: i18n.t("selection.done.title"),
          message: i18n.t("selection.done.message"),
        });
        router.navigate("/cart");
        return;
      }

      // The match left sale since it loaded: nothing was sent. The stale draft
      // goes, and the screen already shows the current (live/result) state.
      if (effects.discardDraft) {
        setSeatPickerOpen(false);
        setSelectedSeats([]);
        setSelectedSeatsIdentity(activeZoneIdentity);
        setDraftQuantities(new Map());
        toast.showToast({
          variant: "info",
          title: i18n.t("selection.notOnSale.title"),
          message: i18n.t("selection.notOnSale.message"),
        });
        return;
      }
      if (outcome.status === "statusUnverified") {
        toast.showToast({
          variant: "error",
          title: i18n.t("selection.error.title"),
          message: i18n.t("selection.statusUnverified"),
        });
        return;
      }

      // Not confirmed: drafts stay. They are re-diffed against whatever the
      // cart authoritatively shows, and when the outcome is unknown the cart
      // must be re-read before another attempt.
      if (effects.needsReconcile) cart.requireCartReconciliation("unconfirmed-mutation");
      toast.showToast({
        variant: "error",
        title: effects.needsReconcile
          ? i18n.t("selection.unconfirmed.title")
          : i18n.t("selection.error.title"),
        message: effects.needsReconcile
          ? reasonWithGuidance(outcome.status === "failed" ? outcome.error : null, i18n.t("selection.unconfirmed.message"))
          : ticketErrorMessage(
              i18n,
              "cart",
              failureKind ?? "generic",
              outcome.status === "failed" ? failureReason(outcome.error) : null,
            ),
      });
    } finally {
      setIsCommitting(false);
    }
  };

  // Re-reads the cart through its owner. Only a confirmed publication lifts
  // the block; the drafts are then compared with that authoritative cart.
  const reconcileCart = async () => {
    if (isReconciling || isCommitting) return;
    setIsReconciling(true);
    try {
      // The owner releases the shared gate only for a confirmed read.
      const result = await cart.refreshCart();
      if (result.confirmed) return;
      toast.showToast({
        variant: "error",
        title: i18n.t("selection.unconfirmed.title"),
        message: i18n.t("selection.reconcileFailed"),
      });
    } catch (error) {
      toast.showToast({
        variant: "error",
        title: i18n.t("selection.unconfirmed.title"),
        message: userFacingError(error, i18n.t("selection.reconcileFailed")),
      });
    } finally {
      setIsReconciling(false);
    }
  };

  const toggleSeat = (seat: ApiSeat) => {
    if (isCommitting || !isSeatSelectable(seat, cartSeatIds)) return;
    setSelectedSeatsIdentity(activeZoneIdentity);
    setSelectedSeats(
      (current) =>
        toggleDraftSeat(
          current,
          seat,
          selectedSeatsIdentity === activeZoneIdentity,
          cartSeatIds,
        ) ?? current,
    );
  };

  const removeDraftSeat = (seatId: number) => {
    if (selectedSeatsIdentity !== activeZoneIdentity) return;
    setSelectedSeats((current) => current.filter((item) => item !== seatId));
  };

  const clearDraftSeats = () => {
    setSelectedSeats([]);
    setSelectedSeatsIdentity(activeZoneIdentity);
  };

  const header = (subtitle: string) => (
    <View style={[local.flowHeader, { paddingTop: insets.top }]}>
      <FlowHeader title={i18n.t("matchDetail.title")} subtitle={subtitle} onBack={handleBack} />
    </View>
  );

  if (loading || (match !== null && !matchBelongsToRoute)) {
    return (
      <View style={[local.root, { backgroundColor: theme.colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        {header(i18n.t("matchDetail.loading"))}
        <View style={[local.column, { width: columnWidthFor(responsive.contentWidth) }]}>
          <MatchDetailSkeleton label={i18n.t("matchDetail.loading")} />
        </View>
      </View>
    );
  }

  if (!match || !matchBelongsToRoute) {
    const notFound = errorKind === "notFound";
    return (
      <View style={[local.root, { backgroundColor: theme.colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        {header(i18n.t("matchDetail.unavailableSubtitle"))}
        <View style={[local.column, local.centered, { width: columnWidthFor(responsive.contentWidth) }]}>
          <StatePanel
            variant={notFound ? "unavailable" : "error"}
            title={
              notFound
                ? i18n.t("matchDetail.notFound.title")
                : i18n.t("matchDetail.error.title")
            }
            message={ticketErrorMessage(i18n, "match", errorKind ?? "generic", errorReason)}
            action={{
              label: i18n.t("common.retry"),
              onPress: () => void loadMatch(),
            }}
          />
        </View>
      </View>
    );
  }

  // Only a scheduled match is a ticket-purchase experience. Live, completed
  // and any other status get match information / result instead, even when
  // the response still carries zones: no zone list, stepper, seat picker or
  // cart action is rendered for them.
  const experience = matchDetailExperience(match.status);
  if (experience !== "purchase") {
    return (
      <View style={[local.root, { backgroundColor: theme.colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <MatchInfoView
          match={match}
          experience={experience}
          topInset={insets.top}
          compact={responsive.isNarrow}
          contentWidth={columnWidthFor(responsive.contentWidth)}
          onBack={handleBack}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void loadMatch(true);
          }}
        />
      </View>
    );
  }

  const columnWidth = columnWidthFor(responsive.contentWidth);
  // The map card has 14pt padding on each side (v3).
  const mapWidth = Math.min(Math.max(0, columnWidth - 28), 560);
  const mapHeight = Math.round((mapWidth * mapViewHeight) / MAP_VIEW_W);
  // The seat card has 16pt padding on each side.
  const seatMapSize = Math.max(0, columnWidth - spacing.lg * 2);
  const labels = matchLabels(match, i18n);

  const selectZone = (
    zone: ApiZone,
    revealInList = false,
    fromStadium = false,
  ) => {
    commitZone(zone, routeMatchId);
    setStadiumFocusedZone(
      fromStadium ? { matchId: routeMatchId, zoneId: zone.id } : null,
    );
    if (!revealInList) return;
    // From the stadium map: bring the zone's row into view.
    requestAnimationFrame(() => {
      const rowY = zoneCardLayouts.current.get(zone.id);
      if (rowY === undefined) return;
      pageScrollRef.current?.scrollTo({
        y: Math.max(0, ticketSectionY.current + SHEET_PADDING_TOP + zoneListY.current + rowY - spacing.xxxl * 3),
        animated: !reducedMotion,
      });
    });
  };

  // Display-only estimate: the tickets this commit would leave in the cart
  // for each changed GA zone plus the pending seats. It only labels the action.
  const estimate = selectionEstimate([
    ...gaChanges.map((change) => {
      const zone = zones.find((item) => item.id === change.zoneId);
      return {
        quantity: change.to,
        unitPrice: zone?.price,
        currency: zone?.currency,
      };
    }),
    ...(selectedZone?.has_seats
      ? [
          {
            quantity: seatDraft.actionableIds.length,
            unitPrice: selectedZone.price,
            currency: selectedZone.currency,
          },
        ]
      : []),
  ]);
  const showSeatPicker = seatPickerOpen && Boolean(selectedZone?.has_seats);
  const pendingSeatCount = seatDraft.actionableIds.length;
  const actionLabel = needsCartReconcile
    ? i18n.t("selection.refresh")
    : !auth.isAuthenticated
      ? i18n.t("selection.signIn")
      : isCommitting
        ? i18n.t("selection.confirming")
        : selectionActionKind(gaChanges) === "update"
          ? i18n.t("selection.update")
          : showSeatPicker
            ? pendingSeatCount
              ? i18n.plural("seats.hold", pendingSeatCount)
              : i18n.t("seats.select")
            : estimate.tickets > 0
              ? i18n.plural("selection.addCount", estimate.tickets)
              : i18n.t("selection.add");
  // Signed-out users can always press through to sign in; otherwise the
  // action waits for a valid preflight (e.g. a current seat snapshot).
  const actionDisabled =
    isCommitting ||
    isReconciling ||
    (!needsCartReconcile && auth.isAuthenticated && !preflight.canConfirm);
  const barNotice = needsCartReconcile
    ? i18n.t("selection.unconfirmed.message")
    : !preflight.canConfirm && preflight.reason === "seatsPending"
      ? visibleSeatError
        ? i18n.t("selection.seatsFailed")
        : i18n.t("selection.seatsChecking")
      : i18n.t("selection.estimateNote");
  // The one explicit confirmation action for this screen (see commitSelections).
  const primaryAction = {
    label: actionLabel,
    onPress: needsCartReconcile
      ? () => void reconcileCart()
      : () => void commitSelections(),
    disabled: actionDisabled,
    busy: isCommitting || isReconciling,
    accessibilityHint: needsCartReconcile
      ? i18n.t("selection.refreshHint")
      : auth.isAuthenticated
        ? i18n.t("selection.addHint")
        : i18n.t("selection.signInHint"),
  };

  const summarySeats = seatDraft.actionable.map((seat) => ({
    id: seat.id,
    label: getSeatIdentity(seat),
  }));
  const reconcileNotice = needsCartReconcile ? (
    <AppText variant="meta" tone="danger" accessibilityLiveRegion="polite">
      {barNotice}
    </AppText>
  ) : null;
  const barFrame = (bar: ReactNode) => (
    <View
      style={local.actionBar}
      onLayout={(event) => setTransactionBarHeight(event.nativeEvent.layout.height)}
    >
      {bar}
    </View>
  );

  if (showSeatPicker && selectedZone) {
    const unitPrice = formatMoney(selectedZone.price, selectedZone.currency);
    return (
      <View style={[local.root, { backgroundColor: theme.colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[local.flowHeader, { paddingTop: insets.top }]}>
          <FlowHeader
            title={selectedZone.name}
            subtitle={i18n.t("seats.picker.subtitle", { home: labels.home, away: labels.away })}
            backLabel={i18n.t("flow.match")}
            onBack={() => setSeatPickerOpen(false)}
            // v3 seats: Android shows a plain 20pt title over the fixture.
            androidTitle="plain"
          />
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            local.pickerContent,
            { width: columnWidth, paddingBottom: transactionBarHeight + spacing.lg },
          ]}
        >
          <SeatLegend />
          {visibleSeatError ? (
            <StatePanel
              variant="error"
              title={i18n.t("seats.error.title")}
              message={ticketErrorMessage(i18n, "seats", visibleSeatError, visibleSeatErrorReason)}
              action={{
                label: i18n.t("common.retry"),
                onPress: () => setSeatRetryNonce((value) => value + 1),
              }}
            />
          ) : seatLoading || !seatSnapshotLoaded ? (
            <SkeletonGroup label={i18n.t("seats.loading")}>
              <SkeletonBlock
                height={Math.round(seatMapSize * 0.6)}
                borderRadius={radius.xl}
              />
            </SkeletonGroup>
          ) : !visibleSeats.length ? (
            <StatePanel
              variant="unavailable"
              title={i18n.t("seats.empty.title")}
              message={i18n.t("seats.empty.message")}
            />
          ) : (
            <>
              <PhysicalLayout
                style={[
                  local.seatCard,
                  { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard },
                ]}
              >
                <PitchBar />
                <SeatMap
                  seats={visibleSeats}
                  zoneName={selectedZone.name}
                  selectedIds={seatDraft.actionableIds}
                  cartSeatIds={cartSeatIds}
                  size={seatMapSize - spacing.lg * 2}
                  zoom={seatZoom}
                  disabled={isCommitting}
                  onToggleSeat={toggleSeat}
                />
              </PhysicalLayout>
              <SeatZoomControls
                zoom={seatZoom}
                canZoomOut={seatZoom > SEAT_ZOOM_LEVELS[0]}
                canZoomIn={
                  seatZoom < SEAT_ZOOM_LEVELS[SEAT_ZOOM_LEVELS.length - 1]
                }
                onZoomOut={() => setSeatZoom((value) => stepSeatZoom(value, -1))}
                onZoomIn={() => setSeatZoom((value) => stepSeatZoom(value, 1))}
              />
              {seatDraft.droppedIds.length ? (
                <AppText
                  variant="meta"
                  tone="danger"
                  accessibilityLiveRegion="polite"
                >
                  {i18n.plural("seats.dropped", seatDraft.droppedIds.length)}
                </AppText>
              ) : null}
            </>
          )}
        </ScrollView>
        {barFrame(
          <TransactionBar
            stacked
            accessory={reconcileNotice}
            leading={
              <SelectedSeatChips
                seats={summarySeats}
                unitPriceLabel={unitPrice}
                disabled={isCommitting}
                onRemove={removeDraftSeat}
                onClear={clearDraftSeats}
              />
            }
            note={!needsCartReconcile && pendingSeatCount ? barNotice : undefined}
            primaryAction={primaryAction}
          />,
        )}
      </View>
    );
  }

  const zoneBar = !selectedZone ? null : selectedZone.has_seats && !needsCartReconcile ? (
    <TransactionBar
      stacked
      leading={
        <View style={local.barInfo}>
          <AppText variant="bodyStrong" numberOfLines={1} style={local.barTitle}>{selectedZone.name}</AppText>
          <AppText variant="body" tone="muted" numberOfLines={2}>
            {pendingSeatCount
              ? `${i18n.t("tickets.perSeatPrice", { price: formatMoney(selectedZone.price, selectedZone.currency) })} · ${i18n.plural("tickets.selected", pendingSeatCount)}`
              : i18n.t("tickets.perSeatPrice", { price: formatMoney(selectedZone.price, selectedZone.currency) })}
          </AppText>
        </View>
      }
      note={gaChanges.length ? i18n.t("selection.otherPending") : undefined}
      primaryAction={{
        label: i18n.t("tickets.chooseSeats"),
        onPress: () => setSeatPickerOpen(true),
        accessibilityHint: i18n.t("tickets.zone.selectHint"),
      }}
    />
  ) : (
    <TransactionBar
      stacked
      accessory={reconcileNotice}
      leading={
        selectedZone.has_seats ? null : (
          <View style={local.barRow}>
            <View style={local.barInfo}>
              <AppText variant="bodyStrong" numberOfLines={1} style={local.barTitle}>{selectedZone.name}</AppText>
              <AppText variant="meta" tone="muted" numberOfLines={2}>
                {i18n.t("tickets.eachGa", { price: formatMoney(selectedZone.price, selectedZone.currency) })}
              </AppText>
            </View>
            <GaZoneStepper
              zoneName={selectedZone.name}
              quantity={getDraftQuantity(selectedZone.id)}
              disabled={isCommitting}
              onIncrement={() => incrementGaDraft(selectedZone)}
              onDecrement={() => decrementGaDraft(selectedZone)}
            />
          </View>
        )
      }
      note={needsCartReconcile ? undefined : barNotice}
      primaryAction={primaryAction}
    />
  );

  return (
    <View style={[local.root, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        ref={pageScrollRef}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={theme.colors.primary}
            onRefresh={() => {
              setRefreshing(true);
              void loadMatch(true);
            }}
          />
        }
        contentContainerStyle={{
          paddingBottom: zoneBar ? transactionBarHeight + spacing.lg : spacing.xxxl,
        }}
      >
        <MatchDetailHero
          match={match}
          compact={responsive.isNarrow}
          topInset={insets.top}
          onBack={handleBack}
        />

        {/* v3 content sheet: overlaps the hero by 24pt with rounded top corners. */}
        <View
          style={[local.sheet, { backgroundColor: theme.colors.background }]}
          onLayout={(event) => {
            ticketSectionY.current = event.nativeEvent.layout.y;
          }}
        >
          <View style={[local.column, { width: columnWidth }]}>
            <View style={local.sitHeader}>
              <View style={local.sitCopy}>
                <AppText variant="displayDay" accessibilityRole="header" style={local.sitTitle}>
                  {i18n.t("sit.title")}
                </AppText>
                <AppText variant="body" tone="muted">
                  {!zones.length
                    ? i18n.t("tickets.empty.title")
                    : stadiumExpanded
                      ? i18n.t("sit.hintMap")
                      : i18n.t("sit.hintList")}
                </AppText>
              </View>
              {zones.length ? (
                <MapToggle
                  expanded={stadiumExpanded}
                  onToggle={() => setStadiumExpanded((value) => !value)}
                />
              ) : null}
            </View>

            {zones.length && stadiumExpanded ? (
              <PhysicalLayout
                style={[
                  local.mapCard,
                  { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard },
                ]}
              >
                <ZoneMap
                  zones={zones}
                  selectedZoneId={
                    stadiumFocusedZone?.matchId === routeMatchId
                      ? stadiumFocusedZone.zoneId
                      : (selectedZone?.id ?? null)
                  }
                  mapImageUrl={mapImageUrl}
                  width={mapWidth}
                  height={mapHeight}
                  viewHeight={mapViewHeight}
                  onSelectZone={(zone) => selectZone(zone, true, true)}
                />
                <MapLegend />
              </PhysicalLayout>
            ) : null}

            {!zones.length ? (
              <StatePanel
                variant="empty"
                title={i18n.t("tickets.empty.title")}
                message={i18n.t("tickets.empty.message")}
              />
            ) : (
              <View
                onLayout={(event) => {
                  zoneListY.current = event.nativeEvent.layout.y;
                }}
              >
              <ZoneList label={i18n.t("sit.title")}>
                {zones.map((zone, index) => {
                  const selected = selectedZone?.id === zone.id;
                  const cartLine = cartByZone.get(zone.id);
                  const price = formatMoney(zone.price, zone.currency);
                  const kindLabel = zone.has_seats
                    ? i18n.t("tickets.kind.reserved")
                    : i18n.t("tickets.kind.ga");
                  const unitLabel = zone.has_seats
                    ? i18n.t("tickets.perSeat")
                    : i18n.t("tickets.perTicket");
                  const inCartQuantity = zone.has_seats
                    ? (cartLine?.seatCount ?? 0)
                    : (cartLine?.quantity ?? 0);
                  // A GA draft that differs from the cart stays visible on its
                  // row after another zone is selected, so it is never hidden.
                  const gaDraft = zone.has_seats ? null : gaChanges.find((change) => change.zoneId === zone.id);
                  const detail = [
                    kindLabel,
                    gaDraft
                      ? i18n.plural("tickets.selected", getDraftQuantity(zone.id))
                      : inCartQuantity > 0
                        ? i18n.plural("tickets.inCart", inCartQuantity)
                        : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");

                  return (
                    <View
                      key={zone.id}
                      onLayout={(event) =>
                        zoneCardLayouts.current.set(
                          zone.id,
                          event.nativeEvent.layout.y,
                        )
                      }
                    >
                      <ZoneRow
                        name={zone.name}
                        detail={detail}
                        priceLabel={price}
                        selected={selected}
                        first={index === 0}
                        onPress={() => selectZone(zone)}
                        accessibilityLabel={i18n.t("tickets.zone.a11y", {
                          zone: zone.name,
                          kind: detail,
                          price,
                          unit: unitLabel,
                        })}
                        accessibilityHint={
                          zone.has_seats
                            ? i18n.t("tickets.zone.selectHint")
                            : i18n.t("tickets.zone.gaHint")
                        }
                      />
                    </View>
                  );
                })}
              </ZoneList>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Presentation-only TransactionBar fed by the screen's draft and
          CartContext; fixed so it stays reachable, with matching scroll
          padding so the last row is never hidden. */}
      {zoneBar ? barFrame(zoneBar) : null}
    </View>
  );
}

/** Readable single column: the page never stretches rows to 1180pt. */
function columnWidthFor(contentWidth: number) {
  return Math.min(contentWidth, COLUMN_MAX_WIDTH);
}

/**
 * v3 "Show map / Hide map" control. Visibility is presentation state only:
 * toggling never refetches the match, the map image or its geometry.
 */
function MapToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const theme = useTheme();
  const i18n = useI18n();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      aria-expanded={expanded}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [
        mapToggleStyles.button,
        { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard },
        pressed && { opacity: 0.7 },
      ]}
    >
      <AppText variant="meta" style={mapToggleStyles.label}>
        {expanded ? i18n.t("stadium.hide") : i18n.t("stadium.show")}
      </AppText>
      <View style={expanded ? mapToggleStyles.chevronOpen : mapToggleStyles.chevron}>
        <SymbolView
          name={{ ios: "chevron.down", android: "expand_more", web: "expand_more" } as never}
          size={14}
          tintColor={theme.colors.textStrong}
          fallback={<AppText variant="caption">⌄</AppText>}
        />
      </View>
    </Pressable>
  );
}

const mapToggleStyles = {
  // v3: 34pt high, radius 12; the press target is extended by hitSlop to 46pt.
  button: {
    minHeight: 34,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexShrink: 0,
  },
  label: { fontWeight: "500" as const },
  chevron: { transform: [{ rotate: "0deg" }] },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
};

/** v3 map legend: kinds of zone and the current selection. Decorative text. */
function MapLegend() {
  const theme = useTheme();
  const i18n = useI18n();
  const items = [
    { key: "reserved", label: i18n.t("stadium.legend.reserved"), fill: zoneKindFill("reserved", theme.colors), border: true },
    { key: "ga", label: i18n.t("stadium.legend.ga"), fill: zoneKindFill("ga", theme.colors), border: true },
    { key: "selected", label: i18n.t("stadium.legend.selected"), fill: theme.colors.actionPrimary, border: false },
  ];
  return (
    <View style={legendStyles.row}>
      {items.map((item) => (
        <View key={item.key} style={legendStyles.item}>
          <View
            style={[
              legendStyles.swatch,
              { backgroundColor: item.fill },
              item.border ? { borderWidth: 1, borderColor: theme.colors.border } : null,
            ]}
          />
          <AppText variant="caption" tone="muted">{item.label}</AppText>
        </View>
      ))}
    </View>
  );
}

const legendStyles = {
  row: { flexDirection: "row" as const, flexWrap: "wrap" as const, columnGap: spacing.lg, rowGap: spacing.xs, marginTop: 10 },
  item: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 4 },
};

/** v3 zone fills by kind (reserved `--bg2`, GA `--card2`); selection is brand red. */
function zoneKindFill(kind: "reserved" | "ga", colors: ThemeColors) {
  return kind === "reserved" ? colors.bgAlt : colors.surfaceSecondary;
}

function zoneColors(zone: ApiZone, active: boolean, colors: ThemeColors) {
  if (active) return { fill: colors.actionPrimary, fillOpacity: 0.7, stroke: colors.actionPrimary };
  return {
    fill: zoneKindFill(zone.has_seats ? "reserved" : "ga", colors),
    fillOpacity: 0.5,
    stroke: colors.textMuted,
  };
}

function errorFacts(error: unknown): TicketErrorFacts {
  if (error instanceof ApiTransportError) {
    return { status: null, transport: error.category };
  }
  if (error instanceof ApiError) return { status: error.status, transport: null };
  return { status: null, transport: null };
}

/** The backend's own reason when it gave one, else catalog copy for the classified failure. */
function ticketErrorMessage(
  i18n: I18n,
  context: TicketErrorContext,
  kind: TicketErrorKind,
  reason?: string | null,
) {
  if (reason) return reason;
  switch (kind) {
    case "offline":
      return i18n.t("ticketError.offline");
    case "timeout":
      return i18n.t("ticketError.timeout");
    case "session":
      return i18n.t("ticketError.session");
    case "expired":
      return i18n.t("ticketError.expired");
    case "unavailable":
      return i18n.t("ticketError.unavailable");
    case "rejected":
      return i18n.t("ticketError.rejected");
    case "maintenance":
      return i18n.t("ticketError.maintenance");
    case "notFound":
      return i18n.t("matchDetail.notFound.message");
    default:
      return context === "match"
        ? i18n.t("ticketError.match")
        : context === "seats"
          ? i18n.t("ticketError.seats")
          : i18n.t("ticketError.cart");
  }
}

function getZonePoints(zone: ApiZone) {
  return getPolygonPoints(zone);
}

function getDisplayZonePoints(zone: ApiZone) {
  return getZonePoints(zone);
}

function getZoneCentroid(zone: ApiZone, viewHeight: number) {
  const points = getDisplayZonePoints(zone);
  if (!points.length) return { x: MAP_VIEW_W / 2, y: viewHeight / 2 };
  return {
    x: points.reduce((sum, point) => sum + Number(point.x), 0) / points.length,
    y: points.reduce((sum, point) => sum + Number(point.y), 0) / points.length,
  };
}

function getZoneBounds(zone: ApiZone) {
  const points = getDisplayZonePoints(zone);
  if (!points.length) return null;
  const xs = points.map((point) => Number(point.x));
  const ys = points.map((point) => Number(point.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function getZoneLabel(zoneName: string) {
  return zoneName.length > 14 ? `${zoneName.slice(0, 12)}...` : zoneName;
}

function getFallbackMapViewHeight(zones: ApiZone[]) {
  const maxY = Math.max(
    0,
    ...zones.flatMap(getZonePoints).map((point) => point.y),
  );
  return maxY ? Math.ceil(maxY + 44) : DEFAULT_MAP_VIEW_H;
}

function parseSvgViewHeight(svgText: string) {
  const viewBox = svgText.match(
    /viewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i,
  );
  if (viewBox) {
    const viewWidth = Number(viewBox[1]);
    const viewHeight = Number(viewBox[2]);
    if (viewWidth > 0 && viewHeight > 0)
      return Math.round((MAP_VIEW_W * viewHeight) / viewWidth);
  }

  const width = svgText.match(/\bwidth=["']([\d.]+)(?:px)?["']/i);
  const height = svgText.match(/\bheight=["']([\d.]+)(?:px)?["']/i);
  const imageWidth = width ? Number(width[1]) : 0;
  const imageHeight = height ? Number(height[1]) : 0;
  return imageWidth > 0 && imageHeight > 0
    ? Math.round((MAP_VIEW_W * imageHeight) / imageWidth)
    : null;
}

function useMapViewHeight(mapImageUrl: string | undefined, zones: ApiZone[]) {
  const fallbackHeight = useMemo(
    () => getFallbackMapViewHeight(zones),
    [zones],
  );
  const mapIdentity = createRequestIdentity([mapImageUrl, fallbackHeight]);
  const [measurement, setMeasurement] = useState<OwnedMapMeasurement | null>(
    null,
  );
  const viewHeight = getOwnedMapHeight(
    measurement,
    mapIdentity,
    fallbackHeight,
  );

  useEffect(() => {
    if (!mapImageUrl) return;

    let cancelled = false;
    const applyHeight = (nextHeight: number | null | undefined) => {
      if (
        !cancelled &&
        nextHeight &&
        Number.isFinite(nextHeight) &&
        nextHeight > 0
      ) {
        setMeasurement({ identity: mapIdentity, height: nextHeight });
      }
    };

    if (mapImageUrl.toLowerCase().split("?")[0].endsWith(".svg")) {
      fetch(mapImageUrl)
        .then((response) => (response.ok ? response.text() : null))
        .then((svgText) =>
          applyHeight(svgText ? parseSvgViewHeight(svgText) : null),
        )
        .catch(() => {
          Image.getSize(mapImageUrl, (imageWidth, imageHeight) => {
            applyHeight(Math.round((MAP_VIEW_W * imageHeight) / imageWidth));
          });
        });
    } else {
      Image.getSize(mapImageUrl, (imageWidth, imageHeight) => {
        applyHeight(Math.round((MAP_VIEW_W * imageHeight) / imageWidth));
      });
    }

    return () => {
      cancelled = true;
    };
  }, [mapIdentity, mapImageUrl]);

  return viewHeight;
}

function NativeStadiumImage({ mapImageUrl }: { mapImageUrl?: string }) {
  const local = useMatchStyles();
  const i18n = useI18n();
  const [imageFailed, setImageFailed] = useState(false);

  if (!mapImageUrl || imageFailed) {
    return (
      <View style={local.mapFallback}>
        <AppText variant="meta" tone="muted">{i18n.t("stadium.unavailable")}</AppText>
      </View>
    );
  }

  return (
    <ExpoImage
      source={{ uri: mapImageUrl }}
      style={local.mapImage}
      contentFit="contain"
      onError={() => setImageFailed(true)}
    />
  );
}

function ZoneMap({
  zones,
  selectedZoneId,
  mapImageUrl,
  width,
  height,
  viewHeight,
  onSelectZone,
}: {
  zones: ApiZone[];
  selectedZoneId: number | null;
  mapImageUrl?: string;
  width: number;
  height: number;
  viewHeight: number;
  onSelectZone: (zone: ApiZone) => void;
}) {
  const local = useMatchStyles();
  const theme = useTheme();
  const i18n = useI18n();
  const imageRect = useMemo(
    () => getContainRect(width, height, MAP_VIEW_W, viewHeight),
    [height, viewHeight, width],
  );

  if (Platform.OS === "web") {
    return createElement(
      "div",
      {
        // Real stadium geometry: never mirrored in RTL.
        dir: "ltr",
        style: {
          alignSelf: "center",
          direction: "ltr",
          width,
          height,
          borderRadius: 14,
          backgroundColor: theme.colors.surfaceSecondary,
          overflow: "hidden",
        },
      },
      createElement(
        "svg",
        {
          viewBox: `0 0 ${MAP_VIEW_W} ${viewHeight}`,
          style: {
            display: "block",
            width: "100%",
            height: "100%",
            cursor: "pointer",
          },
          preserveAspectRatio: "xMidYMid meet",
          // Pointer shortcut only; the ticket list is the accessible zone picker.
          "aria-hidden": true,
        },
        mapImageUrl
          ? createElement("image", {
              href: mapImageUrl,
              x: 0,
              y: 0,
              width: MAP_VIEW_W,
              height: viewHeight,
              preserveAspectRatio: "xMidYMid meet",
            })
          : createElement(
              "text",
              {
                x: MAP_VIEW_W / 2,
                y: viewHeight / 2,
                textAnchor: "middle",
                fontSize: 16,
                fontWeight: 700,
                fill: theme.colors.textMuted,
              },
              i18n.t("stadium.unavailable"),
            ),
        ...zones.map((zone) => {
          const points = getDisplayZonePoints(zone);
          if (!points.length) return null;
          const active = zone.id === selectedZoneId;
          const paint = zoneColors(zone, active, theme.colors);
          const center = getZoneCentroid(zone, viewHeight);

          return createElement(
            "g",
            {
              key: zone.id,
              onClick: () => onSelectZone(zone),
              style: { cursor: "pointer" },
            },
            createElement("polygon", {
              points: points.map((point) => `${point.x},${point.y}`).join(" "),
              fill: paint.fill,
              fillOpacity: paint.fillOpacity,
              stroke: paint.stroke,
              strokeWidth: active ? 2.5 : 1,
              strokeOpacity: active ? 0.9 : 0.6,
            }),
            createElement(
              "text",
              {
                x: center.x,
                y: center.y + 4,
                textAnchor: "middle",
                fontSize: 13,
                fontWeight: 700,
                fill: "#FFFFFF",
                stroke: "rgba(0,0,0,0.65)",
                strokeWidth: 4,
                paintOrder: "stroke",
                style: { pointerEvents: "none", userSelect: "none" },
              },
              getZoneLabel(zone.name),
            ),
            createElement("title", null, zone.name),
          );
        }),
      ),
    );
  }

  return (
    <View
      style={[
        local.mapFrame,
        {
          width,
          height,
          backgroundColor: theme.colors.surfaceSecondary,
        },
      ]}
    >
      <NativeStadiumImage
        key={mapImageUrl ?? "stadium-map-unavailable"}
        mapImageUrl={mapImageUrl}
      />
      <Svg
        width={imageRect.width}
        height={imageRect.height}
        viewBox={`0 0 ${MAP_VIEW_W} ${viewHeight}`}
        preserveAspectRatio="xMidYMid meet"
        pointerEvents="none"
        style={[
          local.zoneOverlay,
          {
            left: imageRect.offsetX,
            top: imageRect.offsetY,
            width: imageRect.width,
            height: imageRect.height,
          },
        ]}
      >
        {zones.map((zone) => {
          const points = getPolygonPointsAttribute(zone);
          if (!points) return null;
          const active = zone.id === selectedZoneId;
          const paint = zoneColors(zone, active, theme.colors);
          return (
            <Polygon
              key={`shape-fill-${zone.id}`}
              points={points}
              fill={paint.fill}
              fillOpacity={paint.fillOpacity}
              stroke={paint.stroke}
              strokeWidth={active ? 2.5 : 1}
            />
          );
        })}
      </Svg>
      {zones.map((zone) => {
        const bounds = getZoneBounds(zone);
        if (!bounds) return null;
        return (
          <Pressable
            key={`shape-touch-${zone.id}`}
            accessible={false}
            onPress={() => onSelectZone(zone)}
            style={[
              local.zoneShape,
              {
                left:
                  imageRect.offsetX +
                  (bounds.minX / MAP_VIEW_W) * imageRect.width,
                top:
                  imageRect.offsetY +
                  (bounds.minY / viewHeight) * imageRect.height,
                width: (bounds.width / MAP_VIEW_W) * imageRect.width,
                height: (bounds.height / viewHeight) * imageRect.height,
                backgroundColor: "transparent",
                borderColor: "transparent",
              },
            ]}
          />
        );
      })}
      {zones.map((zone) => {
        const center = getZoneCentroid(zone, viewHeight);
        const compact = width < 420;
        const markerWidth = compact ? 64 : 84;
        const markerHeight = compact ? 26 : 28;
        const centerX =
          imageRect.offsetX + (center.x / MAP_VIEW_W) * imageRect.width;
        const centerY =
          imageRect.offsetY + (center.y / viewHeight) * imageRect.height;
        const left = Math.max(
          6,
          Math.min(width - markerWidth - 6, centerX - markerWidth / 2),
        );
        const top = Math.max(
          6,
          Math.min(height - markerHeight - 6, centerY - markerHeight / 2),
        );
        const active = zone.id === selectedZoneId;
        return (
          <Pressable
            key={zone.id}
            onPress={() => onSelectZone(zone)}
            accessibilityRole="button"
            accessibilityLabel={zone.name}
            accessibilityState={{ selected: active }}
            aria-selected={active}
            hitSlop={6}
            style={[
              local.zoneMarker,
              {
                left,
                top,
                width: markerWidth,
                minHeight: markerHeight,
                paddingHorizontal: compact ? 5 : 6,
                borderColor: active ? theme.colors.actionPrimary : theme.colors.border,
                backgroundColor: active ? theme.colors.actionPrimary : theme.colors.surface,
              },
            ]}
          >
            <View
              style={[
                local.zoneMarkerDot,
                compact && local.zoneMarkerDotCompact,
                { backgroundColor: active ? "#FFFFFF" : theme.colors.textMuted },
              ]}
            />
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                local.zoneMarkerText,
                { color: theme.colors.textStrong },
                compact && local.zoneMarkerTextCompact,
                active && local.zoneMarkerTextActive,
              ]}
            >
              {compactZoneName(zone.name)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function compactZoneName(value: string) {
  const withoutTeam = value.replace(/\s*\([^)]*\)\s*/g, "").trim();
  return withoutTeam || value;
}

function SeatMap({
  seats,
  zoneName,
  selectedIds,
  cartSeatIds,
  size,
  zoom,
  disabled,
  onToggleSeat,
}: {
  seats: ApiSeat[];
  zoneName: string;
  selectedIds: number[];
  cartSeatIds: Set<number>;
  size: number;
  zoom: number;
  disabled: boolean;
  onToggleSeat: (seat: ApiSeat) => void;
}) {
  const local = useMatchStyles();
  const theme = useTheme();
  const i18n = useI18n();
  const layout = useMemo(() => createSeatLayout(seats, size), [seats, size]);
  // Zoom scales the real seat coordinates uniformly and centres the block
  // with a pure translation, so relative seat positions stay faithful.
  const seatSize = SEAT_SIZE * zoom;
  const contentRight = layout.seats.length
    ? Math.max(...layout.seats.map((seat) => seat.px)) + SEAT_SIZE + SEAT_LAYOUT_PADDING
    : layout.width;
  const scaledContentWidth = contentRight * zoom;
  const frameWidth = Math.max(size, Math.ceil(scaledContentWidth));
  const frameHeight = Math.ceil(layout.height * zoom);
  const offsetX = Math.max(0, (frameWidth - scaledContentWidth) / 2);
  // Invisible press target centred on each glyph: as large as the nearest
  // neighbour allows (up to 48), so targets never overlap. Dense maps reach
  // the 44px guidance by zooming; every seat is also a named button in the
  // screen-reader order.
  const target = useMemo(
    () => seatTouchTarget(layout.seats, zoom, seatSize),
    [layout.seats, seatSize, zoom],
  );

  return (
    <>
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={frameWidth > size}
      style={local.seatMapScroll}
      contentContainerStyle={local.seatMapScroller}
    >
      <View
        style={[
          local.seatMapFrame,
          {
            width: frameWidth,
            height: frameHeight,
          },
        ]}
      >
        {layout.seats.map((seat) => {
          const state = seatVisualState(seat, selectedIds, cartSeatIds);
          const inCart = state === "inCart";
          const accessibility = getSeatAccessibility({
            seat,
            zoneName,
            selected: state === "selected",
            inCart,
          });
          const inactive = accessibility.disabled || disabled;
          return (
            <Pressable
              key={seat.id}
              disabled={inactive}
              onPress={() => onToggleSeat(seat)}
              accessibilityRole="button"
              accessibilityLabel={accessibility.label}
              accessibilityHint={accessibility.hint}
              accessibilityState={{
                selected: accessibility.selected,
                disabled: inactive,
              }}
              aria-selected={accessibility.selected}
              aria-disabled={inactive}
              style={[
                local.seat,
                {
                  width: target.size,
                  height: target.size,
                  left: offsetX + seat.px * zoom + (seatSize - target.size) / 2,
                  top: seat.py * zoom + (seatSize - target.size) / 2,
                  zIndex: state === "selected" ? 3 : inCart ? 2 : 1,
                },
              ]}
            >
              <View
                pointerEvents="none"
                style={[local.seatGlyph, seatGlyphStyle(state, theme.colors, seatSize)]}
              >
                {state === "selected" ? <SelectedSeatMark seatSize={seatSize} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
    {!target.meetsRecommended ? (
      <AppText variant="caption" tone="muted">{i18n.t("seats.zoomHint")}</AppText>
    ) : null}
    </>
  );
}

function useMatchStyles() {
  const theme = useTheme();
  return useMemo(() => createMatchStyles(theme.colors), [theme.colors]);
}

function createMatchStyles(colors: ThemeColors) {
  return {
    root: { flex: 1 },
    flowHeader: { width: "100%" as const, paddingHorizontal: layout.gutter },
    column: { alignSelf: "center" as const, gap: spacing.lg },
    centered: { flex: 1, justifyContent: "center" as const },
    // v3: margin-top -24, radius 26 26 0 0, padding 22 16 16.
    sheet: {
      marginTop: -24,
      borderTopLeftRadius: radius.hero,
      borderTopRightRadius: radius.hero,
      paddingTop: SHEET_PADDING_TOP,
      paddingHorizontal: layout.gutter,
      paddingBottom: spacing.lg,
    },
    sitHeader: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: spacing.md },
    sitCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
    sitTitle: { textTransform: "uppercase" as const },
    mapCard: { padding: 14, borderRadius: radius.xl, marginTop: -spacing.xs },
    pickerContent: { alignSelf: "center" as const, gap: spacing.lg, paddingTop: spacing.sm },
    seatCard: { padding: spacing.lg, borderRadius: 22, gap: spacing.md },
    barRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md },
    barInfo: { flex: 1, minWidth: 0, gap: 2 },
    barTitle: { fontSize: 16, lineHeight: 21 },
    // Fixed transaction area; TransactionBar supplies its own surface,
    // border and safe-area padding.
    actionBar: {
      position: "absolute" as const,
      left: 0,
      right: 0,
      bottom: 0,
    },
    mapFrame: {
      // Real stadium geometry: never mirrored in RTL.
      ...PHYSICAL_LAYOUT_STYLE,
      alignSelf: "center" as const,
      borderRadius: 14,
      backgroundColor: colors.surfaceSecondary,
      overflow: "hidden" as const,
      position: "relative" as const,
    },
    mapImage: { width: "100%" as const, height: "100%" as const, zIndex: 0 },
    zoneOverlay: {
      position: "absolute" as const,
      zIndex: 1,
    },
    mapFallback: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    zoneMarker: {
      position: "absolute" as const,
      zIndex: 3,
      borderRadius: 999,
      borderWidth: 1.5,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      boxShadow: `0px 2px 5px ${colors.shadow}`,
    },
    zoneShape: {
      position: "absolute" as const,
      borderWidth: 1,
      zIndex: 2,
    },
    zoneMarkerDot: { width: 6, height: 6, borderRadius: 3 },
    zoneMarkerDotCompact: { width: 5, height: 5, borderRadius: 3 },
    zoneMarkerText: {
      flex: 1,
      minWidth: 0,
      color: colors.textStrong,
      fontSize: 10,
      fontWeight: "800" as const,
    },
    zoneMarkerTextCompact: { fontSize: 9 },
    zoneMarkerTextActive: { color: "#FFFFFF" },
    seatMapFrame: {
      // Real seat geometry: never mirrored in RTL.
      ...PHYSICAL_LAYOUT_STYLE,
      alignSelf: "center" as const,
      position: "relative" as const,
      overflow: "hidden" as const,
    },
    seatMapScroll: { ...PHYSICAL_LAYOUT_STYLE, width: "100%" as const },
    seatMapScroller: {
      flexGrow: 1,
      justifyContent: "center" as const,
    },
    seat: {
      position: "absolute" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    seatGlyph: {
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
  };
}
