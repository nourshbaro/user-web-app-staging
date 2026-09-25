import { Collapsible } from "@/components/Collapsible";
import { MatchTicketsHeader } from "@/components/MatchTicketsHeader";
import {
  Button,
  Card,
  Empty,
  Loading,
  Screen,
  useResponsive,
  useTheme,
  type ThemeColors,
} from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { PHYSICAL_LAYOUT_STYLE } from "@/i18n/direction";
import { groupCartItems } from "@/lib/cartDisplay";
import { storageUrl } from "@/lib/config";
import { formatDate, formatMoney, formatTime, matchTitle } from "@/lib/format";
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
import { getSeatAccessibility } from "@/lib/seatAccessibility";
import { userFacingError } from "@/lib/userFacingError";
import { matchesService } from "@/services/matches";
import type { ApiMatch, ApiSeat, ApiZone } from "@/types";
import { Image as ExpoImage } from "expo-image";
import { SymbolView } from "expo-symbols";
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
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Polygon } from "react-native-svg";

const MAP_VIEW_W = 600;
const DEFAULT_MAP_VIEW_H = 445;
// Bottom action bar height reserved in scroll content so the last zone/seat
// card is never hidden underneath the fixed "Add to Cart" bar (same pattern
// as cart.tsx's Continue Shopping / Checkout bar).
const ACTION_BAR_HEIGHT = 64;

export default function MatchDetail() {
  const local = useMatchStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const responsive = useResponsive();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [match, setMatch] = useState<ApiMatch | null>(null);
  const [matchIdentity, setMatchIdentity] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<ApiZone | null>(null);
  const [seatSnapshot, setSeatSnapshot] = useState<{
    identity: string;
    seats: ApiSeat[];
  } | null>(null);
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
  // changes — it only becomes real when "Add to Cart" is pressed (see
  // commitSelections). A zone with no entry here simply mirrors whatever is
  // already committed in CartContext (see getDraftQuantity), so returning
  // to Match Details with existing cart lines shows their real quantities
  // without needing a seeding effect.
  const [draftQuantities, setDraftQuantities] = useState<Map<number, number>>(
    () => new Map(),
  );
  const [isCommitting, setIsCommitting] = useState(false);
  const [stadiumExpanded, setStadiumExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seatLoading, setSeatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zoneScrollRef = useRef<ScrollView>(null);
  const zoneChipLayouts = useRef(
    new Map<number, { x: number; width: number }>(),
  );
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
    () =>
      new Set(
        cart.items
          .filter(
            (item) =>
              String(item.match_id) === String(id) &&
              String(item.stadium_zone_id) === String(selectedZone?.id),
          )
          .flatMap(
            (item) =>
              item.seat_ids ?? item.seats?.map((seat) => Number(seat.id)) ?? [],
          ),
      ),
    [cart.items, id, selectedZone?.id],
  );
  // Per-zone cart state for this match, read straight from CartContext —
  // no second quantity authority. General-admission zones resolve to a
  // single { quantity, lockKey } line (mirrors addItem's own merge logic);
  // reserved-seat zones resolve to a seat count used only for the card's
  // informational label (the seat map below remains the source of truth
  // for which seats are selected).
  const cartByZone = useMemo(() => {
    const matchId = String(id ?? "");
    const map = new Map<
      number,
      { quantity: number; lockKey: string; seatCount: number }
    >();
    cart.items.forEach((item) => {
      if (String(item.match_id) !== matchId) return;
      const zoneId = Number(item.stadium_zone_id);
      if (item.type === "zone") {
        map.set(zoneId, {
          quantity: Number(item.quantity ?? 0),
          lockKey: item.lock_key,
          seatCount: 0,
        });
        return;
      }
      const seatCount = item.seat_ids?.length ?? item.seats?.length ?? 0;
      const existing = map.get(zoneId);
      map.set(zoneId, {
        quantity: 0,
        lockKey: item.lock_key,
        seatCount: (existing?.seatCount ?? 0) + seatCount,
      });
    });
    return map;
  }, [cart.items, id]);
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
  const effectiveSelectedSeats = getEffectiveSelectedSeats(
    selectedSeats,
    selectedSeatsIdentity,
    activeZoneIdentity,
    cartSeatIds,
  );
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
      setError(null);
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
          const message = userFacingError(
            err,
            "Could not load this match. Please try again.",
          );
          setError(message);
          toast.showToast({
            variant: "error",
            title: "Could not load match",
            message,
          });
        })
        .finally(() => {
          if (!matchRequestAuthority.isCurrent(ticket, routeMatchId)) return;
          setLoading(false);
          setRefreshing(false);
        });
    },
    [commitZone, matchRequestAuthority, routeMatchId, toast],
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
          toast.showToast({
            variant: "error",
            title: "Could not load seats",
            message: userFacingError(
              err,
              "Could not load seats. Try choosing another zone.",
            ),
          });
          AccessibilityInfo.announceForAccessibility(
            "Could not load seats. Try choosing another zone.",
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
    routeMatchId,
    seatRequestAuthority,
    selectedZone?.has_seats,
    selectedZone?.id,
    selectedZoneBelongsToMatch,
    toast,
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

  // Returns false (and redirects) for a signed-out user, exactly like the
  // previous single add-to-cart action used to.
  const ensureAuthenticated = () => {
    if (auth.isAuthenticated) return true;
    router.push({
      pathname: "/auth",
      params: { returnTo: `/match/${encodeURIComponent(routeMatchId)}` },
    });
    return false;
  };

  // Selection and quantity adjustment happen entirely on this screen — no
  // add/increment ever navigates away by itself. The dedicated Cart page is
  // still the place tickets are reviewed/checked out, reached through the
  // cart affordance in the header.
  const addSelectedSeatsToCart = async () => {
    if (!ensureAuthenticated()) return;
    if (!selectedZone?.has_seats || !effectiveSelectedSeats.length) return;
    try {
      await cart.addItem({
        match_id: Number(id),
        stadium_zone_id: selectedZone.id,
        seat_ids: effectiveSelectedSeats,
      });
      toast.showToast({
        variant: "success",
        title: "Added to cart",
        message: `${effectiveSelectedSeats.length} seat${effectiveSelectedSeats.length === 1 ? "" : "s"} reserved in ${selectedZone.name}.`,
      });
      setSelectedSeats([]);
      setSelectedSeatsIdentity(activeZoneIdentity);
    } catch (err) {
      toast.showToast({
        variant: "error",
        title: "Could not add tickets",
        message: userFacingError(
          err,
          "Could not reserve those tickets. Please try again.",
        ),
      });
    }
  };

  // Pure local draft edit — no request, no CartContext mutation. A zone
  // with no draft entry falls back to its committed cart quantity (see
  // getDraftQuantity below), so this only needs to record zones the user
  // has actually touched.
  const getDraftQuantity = (zoneId: number) =>
    draftQuantities.get(zoneId) ?? cartByZone.get(zoneId)?.quantity ?? 0;

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

  const hasPendingSelection =
    zones.some((zone) => !zone.has_seats && getDraftQuantity(zone.id) > 0) ||
    effectiveSelectedSeats.length > 0;

  // The one explicit confirmation action for this screen. Diffs every GA
  // zone's draft quantity against what's actually committed in
  // CartContext and only sends a request for zones that actually changed
  // (addItem for a new line, updateItem to *set* an existing line to the
  // chosen quantity — never addItem's additive merge, which would turn
  // "existing 2 + chosen 4" into 6 instead of the intended 4 — or
  // removeItem when the chosen quantity is 0). Calls are awaited one at a
  // time: CartContext's addItem is guarded by a single-flight that would
  // otherwise silently drop a second concurrent addItem call and resolve
  // it to the first zone's response, so firing these concurrently would be
  // a real correctness bug, not just an ordering nicety.
  //
  // Reserved-seat zones already made zero requests while seats were being
  // toggled (unchanged from before this pass). Documented change: any
  // seats picked but not yet submitted via the seat map's own "Add N
  // seat(s)" button are now also folded into this same commit, so the
  // bottom "Add to Cart" bar's enabled state (which reflects pending seats
  // too) always has something to actually do when it's enabled. The seat
  // map's own button still works standalone and is unaffected.
  const commitSelections = async () => {
    if (!ensureAuthenticated()) return;
    if (isCommitting || !hasPendingSelection) return;
    setIsCommitting(true);
    try {
      for (const zone of zones) {
        if (zone.has_seats) continue;
        const cartLine = cartByZone.get(zone.id);
        const committed = cartLine?.quantity ?? 0;
        const desired = getDraftQuantity(zone.id);
        if (desired === committed) continue;
        if (!cartLine || committed === 0) {
          await cart.addItem({
            match_id: Number(id),
            stadium_zone_id: zone.id,
            quantity: desired,
          });
        } else if (desired === 0) {
          await cart.removeItem(cartLine.lockKey);
        } else {
          await cart.updateItem(cartLine.lockKey, desired);
        }
      }

      if (selectedZone?.has_seats && effectiveSelectedSeats.length) {
        await cart.addItem({
          match_id: Number(id),
          stadium_zone_id: selectedZone.id,
          seat_ids: effectiveSelectedSeats,
        });
        setSelectedSeats([]);
        setSelectedSeatsIdentity(activeZoneIdentity);
      }

      setDraftQuantities(new Map());
      toast.showToast({
        variant: "success",
        title: "Added to cart",
        message: "Your tickets were added to the cart.",
      });
      router.navigate("/cart");
    } catch (err) {
      // Draft quantities are intentionally left untouched so the user can
      // retry — re-pressing Add to Cart recomputes diffs against whatever
      // did succeed before the failure, so already-synced zones aren't
      // resent.
      toast.showToast({
        variant: "error",
        title: "Could not update cart",
        message: userFacingError(
          err,
          "Could not update your cart. Please try again.",
        ),
      });
    } finally {
      setIsCommitting(false);
    }
  };

  if (loading || (match !== null && !matchBelongsToRoute)) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[local.shell, { width: responsive.contentWidth }]}>
          <MatchTicketsHeader
            title="Match tickets"
            subtitle="Loading match details"
            onBack={handleBack}
            cartCount={0}
            secondsLeft={0}
            compact={responsive.isNarrow}
          />
          <Loading />
        </View>
      </Screen>
    );
  }

  if (!match || !matchBelongsToRoute) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[local.shell, { width: responsive.contentWidth }]}>
          <MatchTicketsHeader
            title="Match tickets"
            subtitle="Details unavailable"
            onBack={handleBack}
            cartCount={cartCount}
            secondsLeft={cart.secondsLeft}
            compact={responsive.isNarrow}
          />
          <Empty
            title="Match unavailable"
            detail={error ?? "This match could not be found."}
          />
        </View>
      </Screen>
    );
  }

  const mapWidth = Math.min(responsive.contentWidth - 32, 560);
  const mapHeight = Math.round((mapWidth * mapViewHeight) / MAP_VIEW_W);
  const seatMapSize = mapWidth;
  const bottomBarPadding = Math.max(insets.bottom, 12);
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
    requestAnimationFrame(() => {
      const layout = zoneChipLayouts.current.get(zone.id);
      if (!layout) return;
      zoneScrollRef.current?.scrollTo({
        x: Math.max(0, layout.x - (mapWidth - layout.width) / 2),
        animated: true,
      });
    });
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <MatchTicketsHeader
          title="Match tickets"
          subtitle={match.stadium?.name ?? "Stadium TBC"}
          onBack={handleBack}
          cartCount={cartCount}
          secondsLeft={cart.secondsLeft}
          compact={responsive.isNarrow}
        />
        <ScrollView
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
            gap: 12,
            paddingBottom: hasPendingSelection
              ? ACTION_BAR_HEIGHT + bottomBarPadding + 16
              : 28,
          }}
        >
          <Card>
            <MatchTeams match={match} showNames={responsive.isTablet} />
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={theme.styles.muted}
            >
              {formatDate(match.match_date)} at {formatTime(match.kickoff_at)}
            </Text>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={theme.styles.muted}
            >
              {match.stadium?.name ?? "Stadium TBC"}
              {match.stadium?.location ? `, ${match.stadium.location}` : ""}
            </Text>
          </Card>

          <Card>
            <Collapsible
              title="Stadium"
              // subtitle="Tap a zone on the map or choose from the list below."
              expanded={stadiumExpanded}
              onToggle={() => setStadiumExpanded((value) => !value)}
              // headerRight={
              //   <Text style={local.countText}>{zones.length} zones</Text>
              // }
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
              <ScrollView
                ref={zoneScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={local.zoneChips}
              >
                {zones.map((zone, index) => {
                  const selected =
                    (zone.has_seats && selectedZone?.id === zone.id) ||
                    (stadiumFocusedZone?.matchId === routeMatchId &&
                      stadiumFocusedZone.zoneId === zone.id);
                  const color = zoneColor(index);
                  return (
                    <Pressable
                      key={zone.id}
                      onPress={() => selectZone(zone)}
                      accessibilityRole="button"
                      accessibilityLabel={zone.name}
                      accessibilityState={{ selected }}
                      onLayout={(event) =>
                        zoneChipLayouts.current.set(
                          zone.id,
                          event.nativeEvent.layout,
                        )
                      }
                      style={[
                        local.zoneChip,
                        {
                          backgroundColor: theme.colors.panelSoft,
                          borderColor: theme.colors.line,
                        },
                        selected && {
                          borderColor: color,
                          backgroundColor: `${color}18`,
                        },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          local.zoneChipText,
                          { color: selected ? color : theme.colors.ink },
                        ]}
                      >
                        {zone.name} - {formatMoney(zone.price, zone.currency)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {!zones.length ? (
                <Text style={theme.styles.muted}>
                  No ticket zones are available for this match.
                </Text>
              ) : null}
            </Collapsible>
          </Card>

          {zones.length ? (
            <Card>
              <Text style={theme.styles.h2}>Zones</Text>
              <View style={local.zoneList}>
                {zones.map((zone, index) => {
                  const selected =
                    (zone.has_seats && selectedZone?.id === zone.id) ||
                    (stadiumFocusedZone?.matchId === routeMatchId &&
                      stadiumFocusedZone.zoneId === zone.id);
                  const color = zoneColor(index);
                  const cartLine = cartByZone.get(zone.id);
                  const gaQuantity = !zone.has_seats
                    ? getDraftQuantity(zone.id)
                    : 0;
                  const zoneAccessibilityLabel = `${zone.name}, ${formatMoney(zone.price, zone.currency)}${zone.has_seats ? ", reserved seating" : ", general admission"}`;

                  return (
                    <View
                      key={zone.id}
                      style={[
                        local.zoneRow,
                        {
                          borderColor: theme.colors.line,
                          backgroundColor: theme.colors.panelSoft,
                        },
                        selected && {
                          borderColor: color,
                          backgroundColor: `${color}14`,
                        },
                      ]}
                    >
                      <View
                        style={[
                          local.zoneRowStripe,
                          { backgroundColor: color },
                        ]}
                      />
                      <Pressable
                        onPress={() => selectZone(zone, true)}
                        accessibilityRole="button"
                        accessibilityLabel={zoneAccessibilityLabel}
                        accessibilityState={{ selected }}
                        style={local.zoneRowMain}
                      >
                        <Text
                          numberOfLines={1}
                          ellipsizeMode="tail"
                          style={[
                            local.zoneRowName,
                            { color: theme.colors.ink },
                          ]}
                        >
                          {zone.name}
                        </Text>
                        <View style={local.zoneRowMeta}>
                          <Text style={theme.styles.muted}>
                            {zone.has_seats
                              ? "Reserved seating"
                              : "General admission"}
                          </Text>
                          {zone.capacity ? (
                            <Text style={theme.styles.muted}>
                              · {zone.capacity} capacity
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                      <View style={local.zoneRowEnd}>
                        <Text
                          style={[
                            local.zoneRowPrice,
                            { color: theme.colors.ink },
                          ]}
                        >
                          {formatMoney(zone.price, zone.currency)}
                        </Text>
                        {zone.has_seats ? (
                          <ReservedZoneStatus
                            zone={zone}
                            selected={selected}
                            color={color}
                            pendingCount={
                              selected ? effectiveSelectedSeats.length : 0
                            }
                            inCartCount={cartLine?.seatCount ?? 0}
                            onPress={() => selectZone(zone, true)}
                          />
                        ) : (
                          <GaZoneStepper
                            quantity={gaQuantity}
                            disabled={isCommitting}
                            onIncrement={() => incrementGaDraft(zone)}
                            onDecrement={() => decrementGaDraft(zone)}
                          />
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            </Card>
          ) : null}

          {selectedZone?.has_seats ? (
            <Card>
              <View style={theme.styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={theme.styles.h2}>Seat map</Text>
                  <Text style={theme.styles.muted}>
                    {selectedZone.name} -{" "}
                    {formatMoney(selectedZone.price, selectedZone.currency)} per
                    seat
                  </Text>
                </View>
                <Text style={local.countText}>
                  {effectiveSelectedSeats.length} selected
                </Text>
              </View>
              {seatLoading ? (
                <Text
                  accessibilityRole="progressbar"
                  accessibilityLabel="Loading seats"
                  accessibilityLiveRegion="polite"
                  style={theme.styles.muted}
                >
                  Loading seats...
                </Text>
              ) : null}
              <SeatMap
                seats={visibleSeats}
                zoneName={selectedZone.name}
                selectedIds={effectiveSelectedSeats}
                cartSeatIds={cartSeatIds}
                size={seatMapSize}
                onToggleSeat={(seat) => {
                  if (!isSeatAvailable(seat) || cartSeatIds.has(seat.id))
                    return;
                  setSelectedSeatsIdentity(activeZoneIdentity);
                  setSelectedSeats((current) => {
                    const actionable =
                      selectedSeatsIdentity === activeZoneIdentity
                        ? current.filter((seatId) => !cartSeatIds.has(seatId))
                        : [];
                    return actionable.includes(seat.id)
                      ? actionable.filter((item) => item !== seat.id)
                      : [...actionable, seat.id];
                  });
                }}
              />
              <SeatLegend />
              {!seatLoading && !visibleSeats.length ? (
                <Text style={theme.styles.muted}>
                  No seat map is available. Choose another zone.
                </Text>
              ) : null}
              <Button
                title={
                  cart.isLoading
                    ? "Adding..."
                    : `Add ${effectiveSelectedSeats.length} seat${effectiveSelectedSeats.length === 1 ? "" : "s"}`
                }
                disabled={!effectiveSelectedSeats.length || cart.isLoading}
                onPress={() => void addSelectedSeatsToCart()}
              />
            </Card>
          ) : null}
        </ScrollView>
      </View>

      {/* The one explicit confirmation action for this screen (see
          commitSelections). Fixed/sticky so it stays reachable no matter
          how long the zone list is; scroll content above reserves matching
          bottom padding so the last card is never hidden under it. */}
      {hasPendingSelection ? (
        <View
          style={[
            local.actionBar,
            {
              paddingBottom: bottomBarPadding,
              backgroundColor: theme.colors.bg,
              borderTopColor: theme.colors.line,
            },
          ]}
        >
          <View
            style={[local.actionBarRow, { width: responsive.contentWidth }]}
          >
            <Button
              title={isCommitting ? "Adding..." : "Add to Cart"}
              disabled={isCommitting}
              onPress={() => void commitSelections()}
            />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

/**
 * Inline "− quantity +" control for a general-admission zone card. Always
 * rendered as the stepper — there is no "Select" state for GA zones any
 * more, so the user immediately understands they're choosing a quantity,
 * starting at 0. Purely a presentation of `quantity`: both buttons call
 * straight back to the draft-quantity setters in the parent (no request,
 * no CartContext mutation — see commitSelections for the one place that
 * actually syncs this to the cart). The minus button disables at zero so
 * it can never go negative.
 */
function GaZoneStepper({
  quantity,
  disabled,
  onIncrement,
  onDecrement,
}: {
  quantity: number;
  disabled: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const theme = useTheme();
  const atZero = quantity <= 0;
  const minusDisabled = disabled || atZero;

  return (
    <View style={local2.stepper}>
      <Pressable
        onPress={onDecrement}
        disabled={minusDisabled}
        accessibilityRole="button"
        accessibilityLabel="Remove one ticket"
        accessibilityState={{ disabled: minusDisabled }}
        hitSlop={8}
        style={[
          local2.stepperButton,
          {
            borderColor: theme.colors.line,
            backgroundColor: theme.colors.panel,
          },
          minusDisabled && local2.stepperDisabled,
        ]}
      >
        <SymbolView name={{ ios: "minus", android: "remove", web: "remove" }} size={20} tintColor={theme.colors.primary} fallback={<View />} />
      </Pressable>
      <Text
        style={[local2.stepperValue, { color: theme.colors.ink }]}
        accessibilityLabel={`${quantity} selected`}
      >
        {quantity}
      </Text>
      <Pressable
        onPress={onIncrement}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Add one ticket"
        accessibilityState={{ disabled }}
        hitSlop={8}
        style={[
          local2.stepperButton,
          {
            borderColor: theme.colors.primary,
            backgroundColor: theme.colors.primary,
          },
          disabled && local2.stepperDisabled,
        ]}
      >
        <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={20} tintColor="#FFFFFF" fallback={<View />} />
      </Pressable>
    </View>
  );
}

/** Reserved-seating zone card status: Select → pick seats below → confirm. */
function ReservedZoneStatus({
  zone,
  selected,
  color,
  pendingCount,
  inCartCount,
  onPress,
}: {
  zone: ApiZone;
  selected: boolean;
  color: string;
  pendingCount: number;
  inCartCount: number;
  onPress: () => void;
}) {
  const theme = useTheme();

  if (pendingCount > 0) {
    return (
      <Text style={[local2.zoneRowCta, { color: theme.colors.primary }]}>
        {pendingCount} pending
      </Text>
    );
  }

  if (inCartCount > 0) {
    return (
      <Text style={[local2.zoneRowCta, { color: theme.colors.green }]}>
        {inCartCount} in cart
      </Text>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Select ${zone.name}`}
      accessibilityState={{ selected }}
      hitSlop={8}
    >
      <Text
        style={[
          local2.zoneRowCta,
          { color: selected ? color : theme.colors.primary },
        ]}
      >
        {selected ? "Choose seats" : "Select"}
      </Text>
    </Pressable>
  );
}

const local2 = {
  zoneRowCta: { fontSize: 12, fontWeight: "800" as const },
  stepper: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
  },
  // 36px square (well above the ~40px including hitSlop:8 touch-target
  // guidance) so − / + stay easy to tap without visually bloating the row.
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  stepperGlyph: { fontSize: 18, fontWeight: "900" as const, lineHeight: 20 },
  stepperValue: {
    minWidth: 22,
    textAlign: "center" as const,
    fontSize: 16,
    fontWeight: "900" as const,
    fontVariant: ["tabular-nums" as const],
  },
  stepperDisabled: { opacity: 0.5 },
};

function MatchTeams({
  match,
  showNames,
}: {
  match: ApiMatch;
  showNames: boolean;
}) {
  const local = useMatchStyles();
  const theme = useTheme();
  const home = match.home_team;
  const away = match.away_team;
  return (
    <View
      style={[local.matchTeams, !showNames && local.matchTeamsCompact]}
      accessibilityLabel={matchTitle(match)}
    >
      <View style={[local.matchTeam, !showNames && local.matchTeamCompact]}>
        <TeamLogo team={home} />
        {showNames ? (
          <Text
            numberOfLines={2}
            style={[local.matchTeamName, { color: theme.colors.ink }]}
          >
            {home?.name ?? "Home"}
          </Text>
        ) : null}
      </View>
      <View
        style={[local.matchVersus, { backgroundColor: theme.colors.panelSoft }]}
      >
        <Text style={[local.matchVersusText, { color: theme.colors.muted }]}>
          VS
        </Text>
      </View>
      <View
        style={[
          local.matchTeam,
          local.matchTeamAway,
          !showNames && local.matchTeamCompact,
        ]}
      >
        <TeamLogo team={away} />
        {showNames ? (
          <Text
            numberOfLines={2}
            style={[local.matchTeamName, { color: theme.colors.ink }]}
          >
            {away?.name ?? "Away"}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function TeamLogo({ team }: { team?: ApiMatch["home_team"] }) {
  const local = useMatchStyles();
  const theme = useTheme();
  return (
    <View
      style={[
        local.matchTeamLogo,
        {
          backgroundColor: theme.colors.panelSoft,
          borderColor: theme.colors.line,
        },
      ]}
    >
      {team?.logo ? (
        <Image
          source={{ uri: storageUrl(team.logo) }}
          style={local.matchTeamImage}
          resizeMode="contain"
        />
      ) : (
        <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>
          {team?.short_name?.slice(0, 3) ?? "LFA"}
        </Text>
      )}
    </View>
  );
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
  const theme = useTheme();
  const [imageFailed, setImageFailed] = useState(false);

  if (!mapImageUrl || imageFailed) {
    return (
      <View style={local.mapFallback}>
        <Text style={theme.styles.muted}>Stadium map unavailable.</Text>
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
  const imageRect = useMemo(
    () => getContainRect(width, height, MAP_VIEW_W, viewHeight),
    [height, viewHeight, width],
  );

  if (Platform.OS === "web") {
    return createElement(
      "div",
      {
        style: {
          alignSelf: "center",
          width,
          height,
          borderRadius: 18,
          border: `1px solid ${theme.colors.line}`,
          backgroundColor: theme.colors.panelSoft,
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
                fill: theme.colors.muted,
              },
              "Stadium map unavailable",
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
          backgroundColor: theme.colors.panelSoft,
          borderColor: theme.colors.line,
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
        const markerWidth = compact ? 56 : 74;
        const markerHeight = compact ? 22 : 24;
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
            style={[
              local.zoneMarker,
              {
                left,
                top,
                width: markerWidth,
                minHeight: markerHeight,
                paddingHorizontal: compact ? 5 : 6,
                borderColor: zoneColor(index),
                backgroundColor: active ? zoneColor(index) : theme.colors.panel,
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
                { color: theme.colors.ink },
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

function isSeatAvailable(seat: ApiSeat) {
  return seat.status === "available";
}

function SeatMap({
  seats,
  zoneName,
  selectedIds,
  cartSeatIds,
  size,
  onToggleSeat,
}: {
  seats: ApiSeat[];
  zoneName: string;
  selectedIds: number[];
  cartSeatIds: Set<number>;
  size: number;
  onToggleSeat: (seat: ApiSeat) => void;
}) {
  const local = useMatchStyles();
  const theme = useTheme();
  const layout = useMemo(() => createSeatLayout(seats, size), [seats, size]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={local.seatMapScroll}
      contentContainerStyle={local.seatMapScroller}
    >
      <View
        style={[
          local.seatMapFrame,
          {
            width: layout.width,
            height: layout.height,
            backgroundColor: theme.colors.panelSoft,
            borderColor: theme.colors.line,
          },
        ]}
      >
        <View style={local.pitchLabel}>
          <Text style={local.pitchLabelText}>Pitch / Field</Text>
        </View>
        {layout.seats.map((seat) => {
          const inCart = cartSeatIds.has(seat.id);
          const active = selectedIds.includes(seat.id) && !inCart;
          const available = isSeatAvailable(seat);
          const accessibility = getSeatAccessibility({
            seat,
            zoneName,
            selected: active,
            inCart,
          });
          return (
            <Pressable
              key={seat.id}
              disabled={!available || inCart}
              onPress={() => onToggleSeat(seat)}
              accessibilityRole="button"
              accessibilityLabel={accessibility.label}
              accessibilityHint={accessibility.hint}
              accessibilityState={{
                selected: accessibility.selected,
                disabled: accessibility.disabled,
              }}
              style={[
                local.seatDot,
                { left: seat.px, top: seat.py },
                inCart && local.seatDotInCart,
                active && local.seatDotSelected,
                !available && local.seatDotDisabled,
              ]}
            />
          );
        })}
      </View>
    </ScrollView>
  );
}

function SeatLegend() {
  const local = useMatchStyles();
  const theme = useTheme();
  return (
    <View style={local.legend}>
      <LegendDot color={theme.colors.green} label="Available" />
      <LegendDot color={theme.colors.primary} label="Selected" />
      <LegendDot color={theme.colors.gold} label="In cart" />
      <LegendDot color="#98A2B3" label="Unavailable" />
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  const local = useMatchStyles();
  const theme = useTheme();
  return (
    <View style={local.legendItem}>
      <View style={[local.legendDot, { backgroundColor: color }]} />
      <Text style={theme.styles.muted}>{label}</Text>
    </View>
  );
}

function useMatchStyles() {
  const theme = useTheme();
  return useMemo(() => createMatchStyles(theme.colors), [theme.colors]);
}

function createMatchStyles(colors: ThemeColors) {
  return {
    shell: { flex: 1, alignSelf: "center" as const },
    // Fixed/sticky "Add to Cart" bar — same pattern as cart.tsx's Continue
    // Shopping / Checkout bar. `paddingBottom` is filled in with the
    // safe-area inset at render time.
    actionBar: {
      position: "absolute" as const,
      left: 0,
      right: 0,
      bottom: 0,
      borderTopWidth: 1,
      paddingTop: 12,
      paddingHorizontal: 14,
      alignItems: "center" as const,
    },
    actionBarRow: { width: "100%" as const },
    matchTeams: {
      width: "100%" as const,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 0,
      paddingVertical: 6,
    },
    matchTeamsCompact: { alignSelf: "center" as const },
    matchTeam: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 12,
    },
    matchTeamAway: { flexDirection: "row-reverse" as const },
    matchTeamCompact: { flex: 1 },
    matchTeamLogo: {
      width: 64,
      height: 64,
      borderRadius: 16,
      borderWidth: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      overflow: "hidden" as const,
    },
    matchTeamImage: { width: 50, height: 50 },
    matchTeamName: {
      flexShrink: 1,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "900" as const,
      textAlign: "center" as const,
    },
    matchVersus: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    matchVersusText: { fontSize: 10, fontWeight: "900" as const },
    countText: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "900" as const,
      textTransform: "uppercase" as const,
    },
    mapFrame: {
      // Real stadium geometry: never mirrored in RTL.
      ...PHYSICAL_LAYOUT_STYLE,
      alignSelf: "center" as const,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelSoft,
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
      shadowColor: colors.ink,
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
      color: colors.ink,
      fontSize: 8,
      fontWeight: "900" as const,
    },
    zoneMarkerTextCompact: { fontSize: 7 },
    zoneMarkerTextActive: { color: "#FFFFFF" },
    zoneChips: { gap: 8, paddingRight: 4 },
    zoneList: { gap: 8 },
    zoneRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 12,
      borderRadius: 14,
      borderWidth: 1,
      paddingVertical: 10,
      paddingHorizontal: 12,
      overflow: "hidden" as const,
    },
    zoneRowStripe: { width: 4, alignSelf: "stretch" as const, borderRadius: 2 },
    zoneRowMain: { flex: 1, minWidth: 0, gap: 2 },
    zoneRowName: { fontSize: 15, fontWeight: "900" as const },
    zoneRowMeta: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: 4,
    },
    // flexShrink: 0 — the price/quantity column must never be squeezed off
    // the edge by a long zone name; zoneRowMain (flex:1, minWidth:0) is
    // what absorbs the extra width and truncates instead.
    zoneRowEnd: { alignItems: "flex-end" as const, gap: 4, flexShrink: 0 },
    zoneRowPrice: { fontSize: 15, fontWeight: "900" as const },
    zoneChip: {
      maxWidth: 240,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panel,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    zoneChipText: {
      color: colors.ink,
      fontSize: 12,
      fontWeight: "800" as const,
    },
    seatMapFrame: {
      // Real seat geometry: never mirrored in RTL.
      ...PHYSICAL_LAYOUT_STYLE,
      alignSelf: "center" as const,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelSoft,
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
      backgroundColor: "rgba(0,122,61,0.08)",
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    pitchLabelText: {
      color: colors.green,
      fontSize: 11,
      fontWeight: "900" as const,
    },
    seatDot: {
      position: "absolute" as const,
      width: 18,
      height: 18,
      borderRadius: 9,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: colors.green,
      borderWidth: 1,
      borderColor: "#FFFFFF",
    },
    seatDotSelected: {
      backgroundColor: colors.primary,
      borderWidth: 3,
      borderColor: "#FFFFFF",
      zIndex: 3,
    },
    seatDotInCart: {
      backgroundColor: colors.gold,
      borderWidth: 3,
      borderColor: "#FFFFFF",
      zIndex: 2,
    },
    seatDotDisabled: { backgroundColor: "#98A2B3", opacity: 0.65 },
    legend: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      gap: 14,
    },
    legendItem: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
    },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
  };
}
