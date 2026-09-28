import { Collapsible } from "@/components/Collapsible";
import { MatchTicketsHeader } from "@/components/MatchTicketsHeader";
import {
  AppText,
  SectionHeader,
  SkeletonBlock,
  SkeletonGroup,
  StatePanel,
  TransactionBar,
} from "@/components/foundation";
import { MatchDetailHero } from "@/components/match/MatchDetailHero";
import { MatchDetailSkeleton } from "@/components/match/MatchSkeletons";
import {
  SeatLegend,
  SeatSelectionSummary,
  SeatZoomControls,
  SelectedSeatMark,
  seatGlyphStyle,
} from "@/components/match/SeatSelection";
import {
  GaZoneStepper,
  ReservedZoneStatus,
  ZoneOptionCard,
} from "@/components/match/TicketOptions";
import {
  Screen,
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
import { groupCartItems } from "@/lib/cartDisplay";
import { storageUrl } from "@/lib/config";
import { radius, spacing } from "@/lib/designTokens";
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
  hasSelectionChanges,
  isSeatSelectable,
  lineSubtotal,
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
import { ApiError, ApiTransportError } from "@/services/api";
import { matchesService } from "@/services/matches";
import type { ApiSeat, ApiZone, ApiMatch } from "@/types";
import { Image as ExpoImage } from "expo-image";
import { Stack, router, useLocalSearchParams } from "expo-router";
import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Image,
  Text,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import Svg, { Polygon } from "react-native-svg";

const MAP_VIEW_W = 600;
const DEFAULT_MAP_VIEW_H = 445;
// Unscaled seat marker size and spacing used by createSeatLayout.
const SEAT_SIZE = 18;
const SEAT_LAYOUT_PADDING = 36;
// Readable single column on tablets and web; the page never stretches cards to 1180px.
const COLUMN_MAX_WIDTH = 760;

type I18n = ReturnType<typeof useI18n>;

export default function MatchDetail() {
  const local = useMatchStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const responsive = useResponsive();
  const theme = useTheme();
  const i18n = useI18n();
  const reducedMotion = useReducedMotion();
  const [match, setMatch] = useState<ApiMatch | null>(null);
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
  // Set when a confirmation ended without a confirmed cart (outcome unknown).
  // The next confirmation is blocked until the cart is re-read from its owner,
  // so an already-applied change is never replayed.
  const [needsCartReconcile, setNeedsCartReconcile] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [stadiumExpanded, setStadiumExpanded] = useState(false);
  const [seatZoom, setSeatZoom] = useState<number>(SEAT_ZOOM_LEVELS[0]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seatLoading, setSeatLoading] = useState(false);
  const [errorKind, setErrorKind] = useState<TicketErrorKind | null>(null);
  const [transactionBarHeight, setTransactionBarHeight] = useState(0);
  const pageScrollRef = useRef<ScrollView>(null);
  const ticketSectionY = useRef(0);
  const zoneCardLayouts = useRef(new Map<number, number>());
  const matchRequestAuthority = useMemo(() => createRequestAuthority(), []);
  const seatRequestAuthority = useMemo(() => createRequestAuthority(), []);
  const selectedZoneRef = useRef<ApiZone | null>(null);
  const selectedZoneMatchIdRef = useRef<string | null>(null);
  const auth = useAuth();
  const cart = useCart();
  const toast = useToast();
  // Same grouping HeaderActions/Cart/Checkout already use for the cart
  // badge count — one shared cart authority, several presentations.
  const cartCount = useMemo(
    () => groupCartItems(cart.items).length,
    [cart.items],
  );
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

  const loadMatch = useCallback(
    (force = false) => {
      const requestIdentity = routeMatchId;
      const ticket = matchRequestAuthority.begin(requestIdentity);
      if (!force) {
        setLoading(true);
        setMatch(null);
        setMatchIdentity(null);
      }
      setErrorKind(null);
      return matchesService
        .details(requestIdentity, force)
        .then((data) => {
          if (!matchRequestAuthority.isCurrent(ticket, routeMatchId)) return;
          const currentZone =
            selectedZoneMatchIdRef.current === requestIdentity
              ? selectedZoneRef.current
              : null;
          const nextZone =
            data.stadium?.zones?.find((zone) => zone.id === currentZone?.id) ??
            data.stadium?.zones?.[0] ??
            null;
          setMatch(data);
          setMatchIdentity(requestIdentity);
          commitZone(nextZone, requestIdentity);
        })
        .catch((err) => {
          if (!matchRequestAuthority.isCurrent(ticket, routeMatchId)) return;
          const kind = ticketErrorKind("match", errorFacts(err));
          setErrorKind(kind);
          // A failed pull-to-refresh keeps the match on screen, so it is
          // reported as a toast; an initial failure is shown inline instead.
          if (force) {
            toast.showToast({
              variant: "error",
              title: i18n.t("matchDetail.refreshError.title"),
              message: ticketErrorMessage(i18n, "match", kind),
            });
          }
        })
        .finally(() => {
          if (!matchRequestAuthority.isCurrent(ticket, routeMatchId)) return;
          setLoading(false);
          setRefreshing(false);
        });
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
          setSeatError({ identity: requestIdentity, kind });
          AccessibilityInfo.announceForAccessibility(
            `${i18n.t("seats.error.title")}. ${ticketErrorMessage(i18n, "seats", kind)}`,
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
  const hasPendingSelection =
    hasSelectionChanges(gaChanges, seatDraft.actionableIds.length) ||
    seatDraft.awaitingSnapshot;

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
    if (isCommitting || isReconciling || needsCartReconcile) return;
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
      });
      const failureKind =
        outcome.status === "failed"
          ? ticketErrorKind("cart", errorFacts(outcome.error))
          : null;
      const effects = commitEffects(outcome, failureKind);

      if (effects.success) {
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

      // Not confirmed: drafts stay. They are re-diffed against whatever the
      // cart authoritatively shows, and when the outcome is unknown the cart
      // must be re-read before another attempt.
      if (effects.needsReconcile) setNeedsCartReconcile(true);
      toast.showToast({
        variant: "error",
        title: effects.needsReconcile
          ? i18n.t("selection.unconfirmed.title")
          : i18n.t("selection.error.title"),
        message: effects.needsReconcile
          ? i18n.t("selection.unconfirmed.message")
          : ticketErrorMessage(i18n, "cart", failureKind ?? "generic"),
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
      const result = await cart.refreshCart();
      if (result.confirmed) {
        setNeedsCartReconcile(false);
        return;
      }
      toast.showToast({
        variant: "error",
        title: i18n.t("selection.unconfirmed.title"),
        message: i18n.t("selection.reconcileFailed"),
      });
    } catch {
      toast.showToast({
        variant: "error",
        title: i18n.t("selection.unconfirmed.title"),
        message: i18n.t("selection.reconcileFailed"),
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

  const header = (subtitle: string, withCart: boolean) => (
    <MatchTicketsHeader
      title={i18n.t("matchDetail.title")}
      subtitle={subtitle}
      onBack={handleBack}
      cartCount={withCart ? cartCount : 0}
      secondsLeft={withCart ? cart.secondsLeft : 0}
      compact={responsive.isNarrow}
    />
  );

  if (loading || (match !== null && !matchBelongsToRoute)) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[local.shell, { width: responsive.contentWidth }]}>
          {header(i18n.t("matchDetail.loading"), false)}
          <View style={local.column}>
            <MatchDetailSkeleton label={i18n.t("matchDetail.loading")} />
          </View>
        </View>
      </Screen>
    );
  }

  if (!match || !matchBelongsToRoute) {
    const notFound = errorKind === "notFound";
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[local.shell, { width: responsive.contentWidth }]}>
          {header(i18n.t("matchDetail.unavailableSubtitle"), true)}
          <View style={[local.column, local.centered]}>
            <StatePanel
              variant={notFound ? "unavailable" : "error"}
              title={
                notFound
                  ? i18n.t("matchDetail.notFound.title")
                  : i18n.t("matchDetail.error.title")
              }
              message={ticketErrorMessage(i18n, "match", errorKind ?? "generic")}
              action={{
                label: i18n.t("common.retry"),
                onPress: () => void loadMatch(),
              }}
            />
          </View>
        </View>
      </Screen>
    );
  }

  const columnWidth = Math.min(responsive.contentWidth, COLUMN_MAX_WIDTH);
  // Section cards have 16px padding on each side.
  const innerWidth = Math.max(0, columnWidth - spacing.lg * 2);
  const mapWidth = Math.min(innerWidth, 560);
  const mapHeight = Math.round((mapWidth * mapViewHeight) / MAP_VIEW_W);
  const seatMapSize = innerWidth;
  const stadiumName = match.stadium?.name ?? i18n.t("match.venueTbc");
  const zoneLegendIndex = new Map(zones.map((zone, index) => [zone.id, index]));

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
    // From the stadium map: bring the zone's ticket card into view.
    requestAnimationFrame(() => {
      const cardY = zoneCardLayouts.current.get(zone.id);
      if (cardY === undefined) return;
      pageScrollRef.current?.scrollTo({
        y: Math.max(0, ticketSectionY.current + cardY - spacing.md),
        animated: !reducedMotion,
      });
    });
  };

  // Display-only estimate for the transaction bar: the tickets this commit
  // would leave in the cart for each changed GA zone plus the pending seats.
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
  const estimateValue =
    estimate.tickets === 0
      ? i18n.t("selection.removal")
      : estimate.mixedCurrency
        ? i18n.t("selection.mixedCurrency")
        : formatMoney(estimate.amount, estimate.currency ?? undefined);
  const showTransactionBar =
    hasPendingSelection || isCommitting || needsCartReconcile;
  const actionLabel = needsCartReconcile
    ? i18n.t("selection.refresh")
    : !auth.isAuthenticated
      ? i18n.t("selection.signIn")
      : selectionActionKind(gaChanges) === "update"
        ? i18n.t("selection.update")
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

  const summarySeats = seatDraft.actionable.map((seat) => ({
    id: seat.id,
    label: getSeatIdentity(seat),
  }));
  const seatSubtotal = selectedZone?.has_seats
    ? lineSubtotal(seatDraft.actionableIds.length, selectedZone.price)
    : null;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        {header(stadiumName, true)}
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
          contentContainerStyle={[
            local.column,
            {
              gap: spacing.lg,
              paddingBottom: showTransactionBar
                ? transactionBarHeight + spacing.lg
                : spacing.xxxl,
            },
          ]}
        >
          <MatchDetailHero match={match} compact={responsive.isNarrow} />

          {zones.length ? (
            <View style={local.section}>
              <Collapsible
                title={i18n.t("stadium.title")}
                subtitle={i18n.t("stadium.subtitle")}
                expanded={stadiumExpanded}
                onToggle={() => setStadiumExpanded((value) => !value)}
              >
                <ZoneMap
                  zones={zones}
                  selectedZoneId={
                    selectedZone?.has_seats
                      ? selectedZone.id
                      : stadiumFocusedZone?.matchId === routeMatchId
                        ? stadiumFocusedZone.zoneId
                        : null
                  }
                  mapImageUrl={mapImageUrl}
                  width={mapWidth}
                  height={mapHeight}
                  viewHeight={mapViewHeight}
                  onSelectZone={(zone) => selectZone(zone, true, true)}
                />
              </Collapsible>
            </View>
          ) : null}

          <View
            style={local.ticketSection}
            onLayout={(event) => {
              ticketSectionY.current = event.nativeEvent.layout.y;
            }}
          >
            <SectionHeader
              title={i18n.t("tickets.title")}
              subtitle={
                zones.length
                  ? i18n.plural("tickets.options", zones.length)
                  : undefined
              }
            />
            {!zones.length ? (
              <StatePanel
                variant="empty"
                title={i18n.t("tickets.empty.title")}
                message={i18n.t("tickets.empty.message")}
              />
            ) : null}
            {zones.map((zone) => {
              const selected =
                (zone.has_seats && selectedZone?.id === zone.id) ||
                (stadiumFocusedZone?.matchId === routeMatchId &&
                  stadiumFocusedZone.zoneId === zone.id);
              const legendColor = zoneColor(zoneLegendIndex.get(zone.id) ?? 0);
              const cartLine = cartByZone.get(zone.id);
              const gaQuantity = !zone.has_seats
                ? getDraftQuantity(zone.id)
                : 0;
              const price = formatMoney(zone.price, zone.currency);
              const kindLabel = zone.has_seats
                ? i18n.t("tickets.kind.reserved")
                : i18n.t("tickets.kind.ga");
              const unitLabel = zone.has_seats
                ? i18n.t("tickets.perSeat")
                : i18n.t("tickets.perTicket");
              const gaSubtotal =
                !zone.has_seats && gaQuantity > 0
                  ? lineSubtotal(gaQuantity, zone.price)
                  : null;
              const inCartQuantity = zone.has_seats
                ? (cartLine?.seatCount ?? 0)
                : (cartLine?.quantity ?? 0);

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
                  <ZoneOptionCard
                    name={zone.name}
                    kindLabel={kindLabel}
                    priceLabel={price}
                    unitLabel={unitLabel}
                    capacityLabel={
                      zone.capacity
                        ? i18n.t("tickets.capacity", {
                            capacity: zone.capacity,
                          })
                        : null
                    }
                    legendColor={legendColor}
                    selected={selected}
                    pressTarget={zone.has_seats ? "card" : "details"}
                    onPress={() => selectZone(zone)}
                    accessibilityLabel={i18n.t("tickets.zone.a11y", {
                      zone: zone.name,
                      kind: kindLabel,
                      price,
                      unit: unitLabel,
                    })}
                    accessibilityHint={
                      zone.has_seats
                        ? i18n.t("tickets.zone.selectHint")
                        : undefined
                    }
                    end={
                      zone.has_seats ? (
                        <ReservedZoneStatus
                          selected={selected}
                          pendingCount={
                            selected ? seatDraft.actionableIds.length : 0
                          }
                          inCartCount={cartLine?.seatCount ?? 0}
                        />
                      ) : (
                        <GaZoneStepper
                          zoneName={zone.name}
                          quantity={gaQuantity}
                          disabled={isCommitting}
                          onIncrement={() => incrementGaDraft(zone)}
                          onDecrement={() => decrementGaDraft(zone)}
                        />
                      )
                    }
                    footer={
                      !zone.has_seats && (inCartQuantity > 0 || gaSubtotal !== null) ? (
                        <View style={local.cardFooter}>
                          {inCartQuantity > 0 ? (
                            <AppText variant="caption" tone="muted">
                              {i18n.plural("tickets.inCart", inCartQuantity)}
                            </AppText>
                          ) : (
                            <View />
                          )}
                          {gaSubtotal !== null ? (
                            <AppText variant="label">
                              {i18n.t("tickets.lineSubtotal", {
                                quantity: gaQuantity,
                                price,
                                subtotal: formatMoney(gaSubtotal, zone.currency),
                              })}
                            </AppText>
                          ) : null}
                        </View>
                      ) : null
                    }
                  />
                </View>
              );
            })}
          </View>

          {selectedZone?.has_seats ? (
            <View style={local.section}>
              <SectionHeader
                title={i18n.t("seats.title")}
                subtitle={i18n.t("seats.subtitle", {
                  zone: selectedZone.name,
                  price: formatMoney(selectedZone.price, selectedZone.currency),
                })}
              />
              {visibleSeatError ? (
                <StatePanel
                  variant="error"
                  title={i18n.t("seats.error.title")}
                  message={ticketErrorMessage(i18n, "seats", visibleSeatError)}
                  action={{
                    label: i18n.t("common.retry"),
                    onPress: () => setSeatRetryNonce((value) => value + 1),
                  }}
                />
              ) : seatLoading || !seatSnapshotLoaded ? (
                <SkeletonGroup label={i18n.t("seats.loading")}>
                  <SkeletonBlock
                    height={Math.round(seatMapSize * 0.6)}
                    borderRadius={radius.lg}
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
                  <View style={local.seatToolbar}>
                    <SeatLegend />
                    <SeatZoomControls
                      zoom={seatZoom}
                      canZoomOut={seatZoom > SEAT_ZOOM_LEVELS[0]}
                      canZoomIn={
                        seatZoom < SEAT_ZOOM_LEVELS[SEAT_ZOOM_LEVELS.length - 1]
                      }
                      onZoomOut={() => setSeatZoom((value) => stepSeatZoom(value, -1))}
                      onZoomIn={() => setSeatZoom((value) => stepSeatZoom(value, 1))}
                    />
                  </View>
                  <SeatMap
                    seats={visibleSeats}
                    zoneName={selectedZone.name}
                    selectedIds={seatDraft.actionableIds}
                    cartSeatIds={cartSeatIds}
                    size={seatMapSize}
                    zoom={seatZoom}
                    disabled={isCommitting}
                    onToggleSeat={toggleSeat}
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
                  <SeatSelectionSummary
                    seats={summarySeats}
                    count={seatDraft.actionableIds.length}
                    zoneName={selectedZone.name}
                    unitPriceLabel={formatMoney(
                      selectedZone.price,
                      selectedZone.currency,
                    )}
                    subtotalLabel={
                      seatSubtotal !== null && seatDraft.actionableIds.length
                        ? formatMoney(seatSubtotal, selectedZone.currency)
                        : null
                    }
                    disabled={isCommitting}
                    onRemove={removeDraftSeat}
                    onClear={clearDraftSeats}
                  />
                </>
              )}
            </View>
          ) : null}
        </ScrollView>
      </View>

      {/* The one explicit confirmation action for this screen (see
          commitSelections). Presentation-only TransactionBar fed by the
          screen's draft and CartContext; fixed so it stays reachable, with
          matching scroll padding so the last card is never hidden. */}
      {showTransactionBar ? (
        <View
          style={local.actionBar}
          onLayout={(event) =>
            setTransactionBarHeight(event.nativeEvent.layout.height)
          }
        >
          <TransactionBar
            totalLabel={i18n.t("selection.total")}
            totalValue={estimateValue}
            countLabel={
              estimate.tickets > 0
                ? i18n.plural("transaction.ticketCount", estimate.tickets)
                : undefined
            }
            accessory={
              <AppText
                variant="caption"
                tone={needsCartReconcile ? "danger" : "muted"}
                accessibilityLiveRegion="polite"
              >
                {barNotice}
              </AppText>
            }
            primaryAction={{
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
            }}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function errorFacts(error: unknown): TicketErrorFacts {
  if (error instanceof ApiTransportError) {
    return { status: null, transport: error.category };
  }
  if (error instanceof ApiError) return { status: error.status, transport: null };
  return { status: null, transport: null };
}

/** Catalog message for a classified failure; backend wording is never shown. */
function ticketErrorMessage(
  i18n: I18n,
  context: TicketErrorContext,
  kind: TicketErrorKind,
) {
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

function zoneColor(index: number) {
  return ["#C8102E", "#007A3D", "#2563EB", "#C8A84B", "#7C3AED", "#0E7490"][
    index % 6
  ];
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
          borderRadius: 18,
          border: `1px solid ${theme.colors.border}`,
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
        ...zones.map((zone, index) => {
          const points = getDisplayZonePoints(zone);
          if (!points.length) return null;
          const active = zone.id === selectedZoneId;
          const color = zoneColor(index);
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
              fill: color,
              fillOpacity: active ? 0.75 : 0.35,
              stroke: active ? "#FFFFFF" : color,
              strokeWidth: active ? 2.5 : 1,
              strokeOpacity: active ? 0.9 : 0.5,
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
          borderColor: theme.colors.border,
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
        {zones.map((zone, index) => {
          const points = getPolygonPointsAttribute(zone);
          if (!points) return null;
          const active = zone.id === selectedZoneId;
          const color = zoneColor(index);
          return (
            <Polygon
              key={`shape-fill-${zone.id}`}
              points={points}
              fill={color}
              fillOpacity={active ? 0.5 : 0.28}
              stroke={color}
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
      {zones.map((zone, index) => {
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
                borderColor: zoneColor(index),
                backgroundColor: active ? zoneColor(index) : theme.colors.surface,
              },
            ]}
          >
            <View
              style={[
                local.zoneMarkerDot,
                compact && local.zoneMarkerDotCompact,
                { backgroundColor: active ? "#FFFFFF" : zoneColor(index) },
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
            backgroundColor: theme.colors.surfaceSecondary,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <View
          style={local.pitchLabel}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <AppText variant="caption" style={{ color: theme.colors.tones.success.fg, fontWeight: "800" }}>
            {i18n.t("seats.pitch")}
          </AppText>
        </View>
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
    shell: { flex: 1, alignSelf: "center" as const },
    column: {
      width: "100%" as const,
      maxWidth: COLUMN_MAX_WIDTH,
      alignSelf: "center" as const,
    },
    centered: { flex: 1, justifyContent: "center" as const },
    section: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.md,
    },
    ticketSection: { gap: spacing.md },
    cardFooter: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
    seatToolbar: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: spacing.md,
    },
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
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
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
      shadowColor: colors.textStrong,
      shadowOpacity: 0.08,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 2 },
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
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceSecondary,
      position: "relative" as const,
      overflow: "hidden" as const,
    },
    seatMapScroll: { ...PHYSICAL_LAYOUT_STYLE, width: "100%" as const },
    seatMapScroller: {
      flexGrow: 1,
      justifyContent: "center" as const,
    },
    pitchLabel: {
      position: "absolute" as const,
      left: "28%" as const,
      right: "28%" as const,
      top: 10,
      height: 26,
      borderRadius: 999,
      backgroundColor: colors.tones.success.bg,
      alignItems: "center" as const,
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
