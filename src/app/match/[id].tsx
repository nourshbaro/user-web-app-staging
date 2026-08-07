import { AppHeader } from "@/components/AppHeader";
import { Button, Card, Empty, Loading, Screen, useResponsive, useTheme, type ThemeColors } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { useCartSheet } from "@/context/CartSheetContext";
import { useToast } from "@/context/ToastContext";
import { storageUrl } from "@/lib/config";
import { formatDate, formatMoney, formatTime, matchTitle } from "@/lib/format";
import { createSeatLayout, getContainRect, getPolygonPoints, getPolygonPointsAttribute } from "@/lib/mapGeometry";
import { createRequestAuthority, createRequestIdentity } from "@/lib/requestAuthority";
import { getSeatAccessibility } from "@/lib/seatAccessibility";
import { matchesService } from "@/services/matches";
import type { ApiMatch, ApiSeat, ApiZone } from "@/types";
import { Image as ExpoImage } from "expo-image";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Image, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Svg, { Polygon } from "react-native-svg";

const MAP_VIEW_W = 600;
const DEFAULT_MAP_VIEW_H = 445;

export default function MatchDetail() {
  const local = useMatchStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const responsive = useResponsive();
  const theme = useTheme();
  const [match, setMatch] = useState<ApiMatch | null>(null);
  const [selectedZone, setSelectedZone] = useState<ApiZone | null>(null);
  const [seatSnapshot, setSeatSnapshot] = useState<{ identity: string; seats: ApiSeat[] } | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [selectedZoneMatchId, setSelectedZoneMatchId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seatLoading, setSeatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zoneScrollRef = useRef<ScrollView>(null);
  const zoneChipLayouts = useRef(new Map<number, { x: number; width: number }>());
  const seatRequestAuthority = useMemo(() => createRequestAuthority(), []);
  const cart = useCart();
  const { openCartSheet } = useCartSheet();
  const toast = useToast();
  const cartSeatIds = useMemo(
    () => new Set(
      cart.items
        .filter((item) =>
          String(item.match_id) === String(id) &&
          String(item.stadium_zone_id) === String(selectedZone?.id)
        )
        .flatMap((item) => item.seat_ids ?? item.seats?.map((seat) => Number(seat.id)) ?? []),
    ),
    [cart.items, id, selectedZone?.id],
  );
  const cartItemsSignature = useMemo(
    () => cart.items.map((item) => `${item.lock_key}:${item.quantity}:${item.seat_ids?.join(",") ?? ""}`).join("|"),
    [cart.items],
  );
  const routeMatchId = String(id ?? "");
  const selectedZoneBelongsToMatch = selectedZoneMatchId === routeMatchId;
  const activeSeatIdentity = createRequestIdentity([
    routeMatchId,
    selectedZoneBelongsToMatch ? selectedZone?.id : null,
    cartItemsSignature,
    selectedZoneBelongsToMatch ? selectedZone?.has_seats : false,
  ]);
  const visibleSeats = seatSnapshot?.identity === activeSeatIdentity ? seatSnapshot.seats : [];
  const zones = match?.stadium?.zones ?? [];
  const mapImageUrl = storageUrl(match?.stadium?.mapImageUrl ?? match?.stadium?.map_image);
  const mapViewHeight = useMapViewHeight(mapImageUrl, zones);

  const loadMatch = (force = false) => {
    if (!force) setLoading(true);
    return matchesService.details(id, force)
      .then((data) => {
        setSelectedZoneMatchId(String(id ?? ""));
        setMatch(data);
        setSelectedZone((current) => data.stadium?.zones?.find((zone) => zone.id === current?.id) ?? data.stadium?.zones?.[0] ?? null);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Could not load match.";
        setError(message);
        toast.showToast({ variant: "error", title: "Could not load match", message });
      })
      .finally(() => { setLoading(false); setRefreshing(false); });
  };

  useEffect(() => {
    void loadMatch();
  }, [id]);

  useEffect(() => {
    seatRequestAuthority.mount();
    return () => seatRequestAuthority.unmount();
  }, [seatRequestAuthority]);

  useLayoutEffect(() => {
    seatRequestAuthority.invalidate(activeSeatIdentity);
  }, [activeSeatIdentity, seatRequestAuthority]);

  useEffect(() => {
    setSelectedSeats([]);
    setSeatSnapshot(null);
  }, [selectedZone?.id]);

  useEffect(() => {
    const requestIdentity = activeSeatIdentity;
    const ticket = seatRequestAuthority.begin(requestIdentity);
    const requestedMatchId = routeMatchId;
    const requestedZoneId = selectedZoneBelongsToMatch ? selectedZone?.id : null;
    const requestedHasSeats = selectedZoneBelongsToMatch && Boolean(selectedZone?.has_seats);

    const timeout = setTimeout(() => {
      if (!seatRequestAuthority.isCurrent(ticket, activeSeatIdentity)) return;
      if (requestedZoneId === null || requestedZoneId === undefined || !requestedHasSeats) {
        setSeatLoading(false);
        return;
      }

      setSeatLoading(true);
      void matchesService.seats(requestedMatchId, requestedZoneId)
        .then((data) => {
          if (!seatRequestAuthority.isCurrent(ticket, activeSeatIdentity)) return;
          setSeatSnapshot({ identity: requestIdentity, seats: data.seats });
        })
        .catch((err) => {
          if (!seatRequestAuthority.isCurrent(ticket, activeSeatIdentity)) return;
          toast.showToast({
            variant: "error",
            title: "Could not load seats",
            message: err instanceof Error ? err.message : "Try choosing another zone.",
          });
          AccessibilityInfo.announceForAccessibility("Could not load seats. Try choosing another zone.");
        })
        .finally(() => {
          if (!seatRequestAuthority.isCurrent(ticket, activeSeatIdentity)) return;
          setSeatLoading(false);
        });
    }, 0);

    return () => clearTimeout(timeout);
  }, [activeSeatIdentity, routeMatchId, seatRequestAuthority, selectedZone?.has_seats, selectedZone?.id, selectedZoneBelongsToMatch, toast]);

  useEffect(() => {
    if (!selectedSeats.length || !cartSeatIds.size) return;
    setSelectedSeats((current) => current.filter((seatId) => !cartSeatIds.has(seatId)));
  }, [cartSeatIds, selectedSeats.length]);

  const handleBack = () => {
    if (selectedSeats.length) {
      setSelectedSeats([]);
      return;
    }
    router.replace("/");
  };

  const addToCart = async () => {
    if (!selectedZone) return;
    try {
      await cart.addItem({
        match_id: Number(id),
        stadium_zone_id: selectedZone.id,
        ...(selectedZone.has_seats ? { seat_ids: selectedSeats } : { quantity }),
      });
      toast.showToast({
        variant: "success",
        title: "Added to cart",
        message: selectedZone.has_seats
          ? `${selectedSeats.length} seat${selectedSeats.length === 1 ? "" : "s"} reserved in ${selectedZone.name}.`
          : `${quantity} ticket${quantity === 1 ? "" : "s"} reserved in ${selectedZone.name}.`,
      });
      setSelectedSeats([]);
      openCartSheet();
    } catch (err) {
      toast.showToast({
        variant: "error",
        title: "Could not add tickets",
        message: err instanceof Error ? err.message : "Please try again.",
      });
    }
  };

  if (loading) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[local.shell, { width: responsive.contentWidth }]}>
          <AppHeader title="Match tickets" subtitle="Loading match details" />
          <Loading />
        </View>
      </Screen>
    );
  }

  if (!match) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[local.shell, { width: responsive.contentWidth }]}>
          <AppHeader title="Match tickets" subtitle="Details unavailable" />
          <Empty title="Match unavailable" detail={error ?? "This match could not be found."} />
        </View>
      </Screen>
    );
  }

  const canAdd = selectedZone && (!selectedZone.has_seats || selectedSeats.length > 0);
  const mapWidth = Math.min(responsive.contentWidth - 32, 560);
  const mapHeight = Math.round(mapWidth * mapViewHeight / MAP_VIEW_W);
  const seatMapSize = mapWidth;
  const selectZone = (zone: ApiZone, revealInList = false) => {
    const nextIdentity = createRequestIdentity([routeMatchId, zone.id, cartItemsSignature, zone.has_seats]);
    seatRequestAuthority.invalidate(nextIdentity);
    setSelectedZoneMatchId(routeMatchId);
    setSelectedZone(zone);
    if (!revealInList) return;
    requestAnimationFrame(() => {
      const layout = zoneChipLayouts.current.get(zone.id);
      if (!layout) return;
      zoneScrollRef.current?.scrollTo({ x: Math.max(0, layout.x - (mapWidth - layout.width) / 2), animated: true });
    });
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <AppHeader title="Match tickets" subtitle={match.stadium?.name ?? "Stadium TBC"} onBack={handleBack} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.colors.primary} onRefresh={() => { setRefreshing(true); void loadMatch(true); }} />}
          contentContainerStyle={{ gap: 12, paddingBottom: 28 }}
        >
          <Card>
            <MatchTeams match={match} showNames={responsive.isTablet} />
            <Text style={theme.styles.muted}>{formatDate(match.match_date)} at {formatTime(match.kickoff_at)}</Text>
            <Text style={theme.styles.muted}>{match.stadium?.name ?? "Stadium TBC"}{match.stadium?.location ? `, ${match.stadium.location}` : ""}</Text>
          </Card>

          <Card>
            <View style={theme.styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={theme.styles.h2}>Stadium map</Text>
                <Text style={theme.styles.muted}>Tap a zone on the map or choose from the list.</Text>
              </View>
              <Text style={local.countText}>{zones.length} zones</Text>
            </View>
            <ZoneMap
              zones={zones}
              selectedZoneId={selectedZone?.id ?? null}
              mapImageUrl={mapImageUrl}
              width={mapWidth}
              height={mapHeight}
              viewHeight={mapViewHeight}
              onSelectZone={(zone) => selectZone(zone, true)}
            />
            <ScrollView ref={zoneScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={local.zoneChips}>
              {zones.map((zone, index) => {
                const selected = selectedZone?.id === zone.id;
                const color = zoneColor(index);
                return (
                <Pressable
                  key={zone.id}
                  onPress={() => selectZone(zone)}
                  accessibilityRole="button"
                  accessibilityLabel={zone.name}
                  accessibilityState={{ selected }}
                  onLayout={(event) => zoneChipLayouts.current.set(zone.id, event.nativeEvent.layout)}
                  style={[
                    local.zoneChip,
                    { backgroundColor: theme.colors.panelSoft, borderColor: theme.colors.line },
                    selected && { borderColor: color, backgroundColor: `${color}18` },
                  ]}
                >
                  <Text numberOfLines={1} style={[local.zoneChipText, { color: selected ? color : theme.colors.ink }]}>
                    {zone.name} - {formatMoney(zone.price, zone.currency)}
                  </Text>
                </Pressable>
                );
              })}
            </ScrollView>
            {!zones.length ? <Text style={theme.styles.muted}>No ticket zones are available for this match.</Text> : null}
          </Card>

          {selectedZone?.has_seats ? (
            <Card>
              <View style={theme.styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={theme.styles.h2}>Seat map</Text>
                  <Text style={theme.styles.muted}>{selectedZone.name} - {formatMoney(selectedZone.price, selectedZone.currency)} per seat</Text>
                </View>
                <Text style={local.countText}>{selectedSeats.length} selected</Text>
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
                selectedIds={selectedSeats}
                cartSeatIds={cartSeatIds}
                size={seatMapSize}
                onToggleSeat={(seat) => {
                  if (!isSeatAvailable(seat) || cartSeatIds.has(seat.id)) return;
                  setSelectedSeats((current) => current.includes(seat.id) ? current.filter((item) => item !== seat.id) : [...current, seat.id]);
                }}
              />
              <SeatLegend />
              {!seatLoading && !visibleSeats.length ? <Text style={theme.styles.muted}>No seat map is available. Choose another zone.</Text> : null}
            </Card>
          ) : selectedZone ? (
            <Card>
              <Text style={theme.styles.h2}>Quantity</Text>
              <Text style={theme.styles.muted}>{selectedZone.name} - {formatMoney(selectedZone.price, selectedZone.currency)} per ticket</Text>
              <View style={theme.styles.row}>
                <Button title="-" variant="secondary" onPress={() => setQuantity((v) => Math.max(1, v - 1))} />
                <Text style={theme.styles.h2}>{quantity}</Text>
                <Button title="+" variant="secondary" onPress={() => setQuantity((v) => Math.min(10, v + 1))} />
              </View>
            </Card>
          ) : null}

          <Button title={cart.isLoading ? "Adding..." : "Add to cart"} disabled={!canAdd || cart.isLoading} onPress={addToCart} />
        </ScrollView>
      </View>
    </Screen>
  );
}

function MatchTeams({ match, showNames }: { match: ApiMatch; showNames: boolean }) {
  const local = useMatchStyles();
  const theme = useTheme();
  const home = match.home_team;
  const away = match.away_team;
  return (
    <View style={[local.matchTeams, !showNames && local.matchTeamsCompact]} accessibilityLabel={matchTitle(match)}>
      <View style={[local.matchTeam, !showNames && local.matchTeamCompact]}>
        <TeamLogo team={home} />
        {showNames ? <Text numberOfLines={2} style={[local.matchTeamName, { color: theme.colors.ink }]}>{home?.name ?? "Home"}</Text> : null}
      </View>
      <View style={[local.matchVersus, { backgroundColor: theme.colors.panelSoft }]}><Text style={[local.matchVersusText, { color: theme.colors.muted }]}>VS</Text></View>
      <View style={[local.matchTeam, local.matchTeamAway, !showNames && local.matchTeamCompact]}>
        <TeamLogo team={away} />
        {showNames ? <Text numberOfLines={2} style={[local.matchTeamName, { color: theme.colors.ink }]}>{away?.name ?? "Away"}</Text> : null}
      </View>
    </View>
  );
}

function TeamLogo({ team }: { team?: ApiMatch["home_team"] }) {
  const local = useMatchStyles();
  const theme = useTheme();
  return (
    <View style={[local.matchTeamLogo, { backgroundColor: theme.colors.panelSoft, borderColor: theme.colors.line }]}>
      {team?.logo ? <Image source={{ uri: storageUrl(team.logo) }} style={local.matchTeamImage} resizeMode="contain" /> : <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>{team?.short_name?.slice(0, 3) ?? "LFA"}</Text>}
    </View>
  );
}

function zoneColor(index: number) {
  return ["#C8102E", "#007A3D", "#2563EB", "#C8A84B", "#7C3AED", "#0E7490"][index % 6];
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
  const maxY = Math.max(0, ...zones.flatMap(getZonePoints).map((point) => point.y));
  return maxY ? Math.ceil(maxY + 44) : DEFAULT_MAP_VIEW_H;
}

function parseSvgViewHeight(svgText: string) {
  const viewBox = svgText.match(/viewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
  if (viewBox) {
    const viewWidth = Number(viewBox[1]);
    const viewHeight = Number(viewBox[2]);
    if (viewWidth > 0 && viewHeight > 0) return Math.round((MAP_VIEW_W * viewHeight) / viewWidth);
  }

  const width = svgText.match(/\bwidth=["']([\d.]+)(?:px)?["']/i);
  const height = svgText.match(/\bheight=["']([\d.]+)(?:px)?["']/i);
  const imageWidth = width ? Number(width[1]) : 0;
  const imageHeight = height ? Number(height[1]) : 0;
  return imageWidth > 0 && imageHeight > 0 ? Math.round((MAP_VIEW_W * imageHeight) / imageWidth) : null;
}

function useMapViewHeight(mapImageUrl: string | undefined, zones: ApiZone[]) {
  const fallbackHeight = useMemo(() => getFallbackMapViewHeight(zones), [zones]);
  const [viewHeight, setViewHeight] = useState(fallbackHeight);

  useEffect(() => {
    setViewHeight(fallbackHeight);
  }, [fallbackHeight]);

  useEffect(() => {
    if (!mapImageUrl) return;

    let cancelled = false;
    const applyHeight = (nextHeight: number | null | undefined) => {
      if (!cancelled && nextHeight && Number.isFinite(nextHeight) && nextHeight > 0) {
        setViewHeight(nextHeight);
      }
    };

    if (mapImageUrl.toLowerCase().split("?")[0].endsWith(".svg")) {
      fetch(mapImageUrl)
        .then((response) => response.ok ? response.text() : null)
        .then((svgText) => applyHeight(svgText ? parseSvgViewHeight(svgText) : null))
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
  }, [fallbackHeight, mapImageUrl]);

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
    <View style={[local.mapFrame, { width, height, backgroundColor: theme.colors.panelSoft, borderColor: theme.colors.line }]}>
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
                left: imageRect.offsetX + (bounds.minX / MAP_VIEW_W) * imageRect.width,
                top: imageRect.offsetY + (bounds.minY / viewHeight) * imageRect.height,
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
        const centerX = imageRect.offsetX + (center.x / MAP_VIEW_W) * imageRect.width;
        const centerY = imageRect.offsetY + (center.y / viewHeight) * imageRect.height;
        const left = Math.max(6, Math.min(width - markerWidth - 6, centerX - markerWidth / 2));
        const top = Math.max(6, Math.min(height - markerHeight - 6, centerY - markerHeight / 2));
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
            <View style={[local.zoneMarkerDot, compact && local.zoneMarkerDotCompact, { backgroundColor: active ? "#FFFFFF" : zoneColor(index) }]} />
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[local.zoneMarkerText, { color: theme.colors.ink }, compact && local.zoneMarkerTextCompact, active && local.zoneMarkerTextActive]}
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
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={local.seatMapScroll} contentContainerStyle={local.seatMapScroller}>
      <View style={[local.seatMapFrame, { width: layout.width, height: layout.height, backgroundColor: theme.colors.panelSoft, borderColor: theme.colors.line }]}>
        <View style={local.pitchLabel}><Text style={local.pitchLabelText}>Pitch / Field</Text></View>
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
  matchTeams: { width: "100%" as const, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 0, paddingVertical: 6 },
  matchTeamsCompact: { alignSelf: "center" as const },
  matchTeam: { flex: 1, minWidth: 0, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 12 },
  matchTeamAway: { flexDirection: "row-reverse" as const },
  matchTeamCompact: { flex: 1 },
  matchTeamLogo: { width: 64, height: 64, borderRadius: 16, borderWidth: 1, alignItems: "center" as const, justifyContent: "center" as const, overflow: "hidden" as const },
  matchTeamImage: { width: 50, height: 50 },
  matchTeamName: { flexShrink: 1, fontSize: 17, lineHeight: 22, fontWeight: "900" as const, textAlign: "center" as const },
  matchVersus: { width: 36, height: 36, borderRadius: 18, alignItems: "center" as const, justifyContent: "center" as const },
  matchVersusText: { fontSize: 10, fontWeight: "900" as const },
  countText: { color: colors.muted, fontSize: 12, fontWeight: "900" as const, textTransform: "uppercase" as const },
  mapFrame: {
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
  mapFallback: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const },
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
  zoneMarkerText: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 8, fontWeight: "900" as const },
  zoneMarkerTextCompact: { fontSize: 7 },
  zoneMarkerTextActive: { color: "#FFFFFF" },
  zoneChips: { gap: 8, paddingRight: 4 },
  zoneChip: {
    maxWidth: 240,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  zoneChipText: { color: colors.ink, fontSize: 12, fontWeight: "800" as const },
  seatMapFrame: {
    alignSelf: "center" as const,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelSoft,
    position: "relative" as const,
    overflow: "hidden" as const,
  },
  seatMapScroll: { width: "100%" as const },
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
  pitchLabelText: { color: colors.green, fontSize: 11, fontWeight: "900" as const },
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
  legend: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 14 },
  legendItem: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  };
}
