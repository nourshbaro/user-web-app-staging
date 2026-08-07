import { useTheme } from "@/components/ui";
import { classifyAdLink, resolveAdImageUrl } from "@/lib/adUrls";
import {
  classifyBannerSwipe,
  createBannerImageInstanceKey,
  createBannerTransitionAuthority,
  isHorizontalBannerGesture,
  normalizeBannerIndex,
  shouldAutoRotateBanners,
  type BannerDisplayIdentity,
  type BannerInstanceRole,
  type BannerSwipeDirection,
  type BannerTransitionOwnership,
} from "@/lib/appBannerCarousel";
import { APP_BANNER_REQUEST_KEY, adsService } from "@/services/ads";
import type { AppBannerAd } from "@/types/ads";
import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Linking,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";

const ROTATION_INTERVAL_MS = 10_000;
const SLIDE_DURATION_MS = 360;
const SNAP_BACK_DURATION_MS = 220;

type DisplayBanner = AppBannerAd & {
  imageUrl: string;
};

type BannerHandoff = {
  banner: DisplayBanner;
  targetIndex: number;
  ownership: BannerTransitionOwnership;
  visible: boolean;
};

export function AppBanner() {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [banners, setBanners] = useState<DisplayBanner[]>([]);

  useEffect(() => {
    let active = true;

    void adsService.appBanner()
      .then((items) => {
        if (!active) return;
        setBanners(items.flatMap((item) => {
          const imageUrl = resolveAdImageUrl(item.image);
          return imageUrl ? [{ ...item, imageUrl }] : [];
        }));
      })
      .catch(() => {
        if (active) setBanners([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.placement}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.frame,
            styles.skeleton,
            { backgroundColor: theme.colors.panelSoft, borderColor: theme.colors.line },
          ]}
        />
      </View>
    );
  }

  if (!banners.length) return null;

  const contentKey = `${APP_BANNER_REQUEST_KEY}|${banners
    .map((banner) => `${banner.id}:${banner.imageUrl}`)
    .join("|")}`;
  return <BannerRotation key={contentKey} banners={banners} />;
}

function BannerRotation({ banners }: { banners: DisplayBanner[] }) {
  const theme = useTheme();
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedIds, setFailedIds] = useState<Set<number>>(() => new Set());
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === "active");
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [timerResetKey, setTimerResetKey] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [suppressPress, setSuppressPress] = useState(false);
  // Banner-level loading remains a warm-up/scheduling hint. Exact native view
  // display ownership is tracked separately by role, source, and generation.
  const [loadedIds, setLoadedIds] = useState<Set<number>>(() => new Set());
  const [handoff, setHandoff] = useState<BannerHandoff | null>(null);
  const [dragX] = useState(() => new Animated.Value(0));
  const transitionInProgressRef = useRef(false);
  const transitionAuthorityRef = useRef(createBannerTransitionAuthority());
  const displayedInstancesRef = useRef(new Map<BannerInstanceRole, string>());
  const draggingRef = useRef(false);
  const mountedRef = useRef(true);
  const prefetchedUrlsRef = useRef(new Set<string>());
  const availableBanners = useMemo(
    () => banners.filter((banner) => !failedIds.has(banner.id)),
    [banners, failedIds],
  );
  const safeActiveIndex = normalizeBannerIndex(activeIndex, availableBanners.length);
  const banner = availableBanners[safeActiveIndex];
  const previousBanner = availableBanners[
    normalizeBannerIndex(safeActiveIndex - 1, availableBanners.length)
  ];
  const nextBanner = availableBanners[
    normalizeBannerIndex(safeActiveIndex + 1, availableBanners.length)
  ];

  useEffect(() => {
    const transitionAuthority = transitionAuthorityRef.current;
    mountedRef.current = true;
    let active = true;

    void Promise.all([
      AccessibilityInfo.isScreenReaderEnabled(),
      AccessibilityInfo.isReduceMotionEnabled(),
    ]).then(([screenReader, reduceMotion]) => {
      if (!active) return;
      setScreenReaderEnabled(screenReader);
      setReduceMotionEnabled(reduceMotion);
    });

    const appStateSubscription = AppState.addEventListener("change", (state) => {
      setAppIsActive(state === "active");
    });
    const screenReaderSubscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setScreenReaderEnabled,
    );
    const reduceMotionSubscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotionEnabled,
    );

    return () => {
      active = false;
      mountedRef.current = false;
      transitionAuthority.invalidate();
      transitionInProgressRef.current = false;
      draggingRef.current = false;
      dragX.stopAnimation();
      appStateSubscription.remove();
      screenReaderSubscription.remove();
      reduceMotionSubscription.remove();
    };
  }, [dragX]);

  useEffect(() => {
    const candidates = [
      ...new Map(
        [previousBanner, nextBanner]
          .filter((item): item is DisplayBanner => Boolean(item))
          .map((item) => [item.imageUrl, item]),
      ).values(),
    ].filter((item) => !prefetchedUrlsRef.current.has(item.imageUrl));

    for (const item of candidates) {
      prefetchedUrlsRef.current.add(item.imageUrl);
      void Image.prefetch(item.imageUrl)
        .catch(() => undefined);
    }
  }, [nextBanner, previousBanner]);

  useEffect(() => {
    if (
      !handoff?.visible
      || safeActiveIndex === handoff.targetIndex
      || !transitionAuthorityRef.current.isCurrent(handoff.ownership)
    ) {
      return;
    }

    // The visible handoff has already painted because effects run after commit.
    // Only now may the track return to center and positional sources reconcile.
    setActiveIndex(handoff.targetIndex);
    dragX.setValue(0);
  }, [dragX, handoff, safeActiveIndex]);

  const releasePressSuppression = useCallback(() => {
    setSuppressPress(false);
  }, []);

  const stopAnimation = useCallback(() => {
    dragX.stopAnimation();
    transitionAuthorityRef.current.invalidate();
    transitionInProgressRef.current = false;
    setAnimating(false);
  }, [dragX]);

  const instanceKey = useCallback((
    role: BannerInstanceRole,
    item: DisplayBanner,
  ) => createBannerImageInstanceKey(role, item.id, item.imageUrl), []);

  const handleInstanceDisplay = useCallback((
    role: BannerInstanceRole,
    item: DisplayBanner,
    ownership?: BannerTransitionOwnership,
  ) => {
    displayedInstancesRef.current.set(role, instanceKey(role, item));
    if (!ownership || !mountedRef.current) return;

    const identity: BannerDisplayIdentity = {
      generation: ownership.generation,
      bannerId: item.id,
      imageUrl: item.imageUrl,
      role,
    };
    if (role === "handoff") {
      if (!transitionAuthorityRef.current.acceptHandoffDisplay(identity)) return;
      setHandoff((current) => (
        current && current.ownership.generation === ownership.generation
          ? { ...current, visible: true }
          : current
      ));
      return;
    }
    if (role !== "current" || !transitionAuthorityRef.current.acceptCurrentDisplay(identity)) {
      return;
    }
    setHandoff(null);
    setAnimating(false);
    transitionInProgressRef.current = false;
    setTimerResetKey((value) => value + 1);
  }, [instanceKey]);

  const isDisplayed = useCallback((
    role: "previous" | "next",
    item: DisplayBanner | undefined,
  ) => Boolean(
    item
    && displayedInstancesRef.current.get(role) === instanceKey(role, item)
  ), [instanceKey]);

  const handleInstanceLoadStart = useCallback((
    role: "previous" | "current" | "next",
    item: DisplayBanner,
  ) => {
    if (displayedInstancesRef.current.get(role) === instanceKey(role, item)) {
      displayedInstancesRef.current.delete(role);
    }
  }, [instanceKey]);

  const moveToIndex = useCallback((
    targetIndex: number,
    direction: BannerSwipeDirection,
  ) => {
    if (
      !availableBanners.length
      || transitionInProgressRef.current
      || draggingRef.current
    ) return;
    const normalizedTarget = normalizeBannerIndex(targetIndex, availableBanners.length);
    const destinationBanner = availableBanners[normalizedTarget];
    const adjacentRole = direction === "next" ? "next" : "previous";

    if (normalizedTarget === safeActiveIndex) {
      dragX.setValue(0);
      return;
    }
    if (
      !destinationBanner
      || !loadedIds.has(destinationBanner.id)
      || !isDisplayed(adjacentRole, destinationBanner)
    ) {
      dragX.setValue(0);
      setTimerResetKey((value) => value + 1);
      return;
    }

    const duration = reduceMotionEnabled || screenReaderEnabled ? 0 : SLIDE_DURATION_MS;
    const destination = direction === "next" ? -viewportWidth : viewportWidth;
    const ownership = transitionAuthorityRef.current.begin(
      destinationBanner.id,
      destinationBanner.imageUrl,
      direction,
    );
    if (!ownership) return;
    transitionInProgressRef.current = true;
    setAnimating(true);
    Animated.timing(dragX, {
      toValue: destination,
      duration,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || !mountedRef.current) {
        transitionAuthorityRef.current.invalidate();
        transitionInProgressRef.current = false;
        setAnimating(false);
        return;
      }
      if (!transitionAuthorityRef.current.isCurrent(ownership)) return;
      setHandoff({
        banner: destinationBanner,
        targetIndex: normalizedTarget,
        ownership,
        visible: false,
      });
    });
  }, [
    availableBanners,
    dragX,
    loadedIds,
    isDisplayed,
    reduceMotionEnabled,
    safeActiveIndex,
    screenReaderEnabled,
    viewportWidth,
  ]);

  const snapBack = useCallback(() => {
    if (transitionInProgressRef.current) return;
    transitionInProgressRef.current = true;
    setAnimating(true);
    Animated.timing(dragX, {
      toValue: 0,
      duration: reduceMotionEnabled || screenReaderEnabled ? 0 : SNAP_BACK_DURATION_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      transitionInProgressRef.current = false;
      if (!finished || !mountedRef.current) return;
      setAnimating(false);
      setTimerResetKey((value) => value + 1);
    });
  }, [dragX, reduceMotionEnabled, screenReaderEnabled]);

  useEffect(() => {
    if (
      !viewportWidth
      || animating
      || draggingRef.current
      || !shouldAutoRotateBanners(
        availableBanners.length,
        appIsActive,
        screenReaderEnabled,
        reduceMotionEnabled,
      )
    ) {
      return;
    }

    const timer = setTimeout(() => {
      moveToIndex(safeActiveIndex + 1, "next");
    }, ROTATION_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [
    appIsActive,
    animating,
    availableBanners.length,
    moveToIndex,
    reduceMotionEnabled,
    safeActiveIndex,
    screenReaderEnabled,
    timerResetKey,
    viewportWidth,
  ]);

  const handleImageError = useCallback((id: number) => {
    dragX.stopAnimation();
    transitionAuthorityRef.current.invalidate();
    dragX.setValue(0);
    const remainingBanners = availableBanners.filter((item) => item.id !== id);
    const nextActiveIndex = id === banner?.id
      ? normalizeBannerIndex(safeActiveIndex, remainingBanners.length)
      : Math.max(0, remainingBanners.findIndex((item) => item.id === banner?.id));
    const recoveryBanner = remainingBanners[nextActiveIndex];
    const keepSafeHandoff = Boolean(handoff?.visible && recoveryBanner);
    const recoveryOwnership = keepSafeHandoff
      ? transitionAuthorityRef.current.beginCurrentRecovery(
        recoveryBanner.id,
        recoveryBanner.imageUrl,
      )
      : null;
    transitionInProgressRef.current = Boolean(recoveryOwnership);
    setAnimating(Boolean(recoveryOwnership));
    setHandoff((current) => (
      current && recoveryOwnership
        ? {
          ...current,
          targetIndex: nextActiveIndex,
          ownership: recoveryOwnership,
          visible: true,
        }
        : null
    ));
    setActiveIndex(nextActiveIndex);
    setFailedIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
    setLoadedIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setTimerResetKey((value) => value + 1);
  }, [availableBanners, banner?.id, dragX, handoff?.visible, safeActiveIndex]);

  const handleImageLoad = useCallback((id: number) => {
    setLoadedIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);

  // The responder callbacks read mutable gesture/transition guards only when native
  // events fire; they do not use those refs to calculate rendered output.
  // eslint-disable-next-line react-hooks/refs
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => (
      availableBanners.length > 1
      && !screenReaderEnabled
      && !transitionInProgressRef.current
      && isHorizontalBannerGesture(gesture.dx, gesture.dy)
    ),
    onMoveShouldSetPanResponderCapture: (_, gesture) => (
      availableBanners.length > 1
      && !screenReaderEnabled
      && !transitionInProgressRef.current
      && isHorizontalBannerGesture(gesture.dx, gesture.dy)
    ),
    onPanResponderGrant: () => {
      draggingRef.current = true;
      setSuppressPress(true);
    },
    onPanResponderMove: (_, gesture) => {
      if (reduceMotionEnabled) return;
      const role = gesture.dx < 0 ? "next" : "previous";
      const item = role === "next" ? nextBanner : previousBanner;
      dragX.setValue(isDisplayed(role, item) ? gesture.dx : 0);
    },
    onPanResponderRelease: (_, gesture) => {
      const direction = classifyBannerSwipe(
        gesture.dx,
        gesture.dy,
        gesture.vx,
        viewportWidth,
      );
      if (direction === "next") {
        draggingRef.current = false;
        moveToIndex(safeActiveIndex + 1, direction);
      } else if (direction === "previous") {
        draggingRef.current = false;
        moveToIndex(safeActiveIndex - 1, direction);
      } else {
        draggingRef.current = false;
        snapBack();
      }
      releasePressSuppression();
    },
    onPanResponderTerminate: () => {
      draggingRef.current = false;
      snapBack();
      releasePressSuppression();
    },
    onPanResponderTerminationRequest: () => false,
  }), [
    availableBanners.length,
    dragX,
    isDisplayed,
    moveToIndex,
    nextBanner,
    previousBanner,
    reduceMotionEnabled,
    releasePressSuppression,
    safeActiveIndex,
    screenReaderEnabled,
    snapBack,
    viewportWidth,
  ]);

  if (!banner) return null;

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    if (nextWidth > 0 && nextWidth !== viewportWidth) {
      stopAnimation();
      dragX.setValue(0);
      setViewportWidth(nextWidth);
    }
  };

  return (
    <View style={styles.placement}>
      <View
        onLayout={handleLayout}
        style={[styles.frame, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}
        {...(availableBanners.length > 1 ? panResponder.panHandlers : {})}
      >
        {viewportWidth > 0 && availableBanners.length > 1 ? (
          <Animated.View
            style={[
              styles.track,
              {
                width: viewportWidth * 3,
                transform: [{ translateX: Animated.add(dragX, -viewportWidth) }],
              },
            ]}
          >
            <BannerSlide
              key="previous"
              banner={previousBanner}
              width={viewportWidth}
              active={false}
              role="previous"
              suppressPress={suppressPress}
              onLoad={handleImageLoad}
              onLoadStart={handleInstanceLoadStart}
              onDisplay={handleInstanceDisplay}
              onError={handleImageError}
            />
            <BannerSlide
              key="current"
              banner={banner}
              width={viewportWidth}
              active
              role="current"
              suppressPress={suppressPress}
              onLoad={handleImageLoad}
              onLoadStart={handleInstanceLoadStart}
              onDisplay={handleInstanceDisplay}
              displayOwnership={
                handoff?.visible && safeActiveIndex === handoff.targetIndex
                  ? handoff.ownership
                  : undefined
              }
              onError={handleImageError}
            />
            <BannerSlide
              key="next"
              banner={nextBanner}
              width={viewportWidth}
              active={false}
              role="next"
              suppressPress={suppressPress}
              onLoad={handleImageLoad}
              onLoadStart={handleInstanceLoadStart}
              onDisplay={handleInstanceDisplay}
              onError={handleImageError}
            />
          </Animated.View>
        ) : (
          <BannerSlide
            banner={banner}
            active
            role="current"
            suppressPress={suppressPress}
            onLoad={handleImageLoad}
            onLoadStart={handleInstanceLoadStart}
            onDisplay={handleInstanceDisplay}
            onError={handleImageError}
          />
        )}
        {handoff ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            // Preparation must not cover the displayed adjacent destination.
            // Only this exact handoff Image's onDisplay promotes the overlay.
            style={[styles.handoff, !handoff.visible && styles.hiddenHandoff]}
          >
            <Image
              key={createBannerImageInstanceKey(
                "handoff",
                handoff.banner.id,
                handoff.banner.imageUrl,
                handoff.ownership.generation,
              )}
              recyclingKey={createBannerImageInstanceKey(
                "handoff",
                handoff.banner.id,
                handoff.banner.imageUrl,
                handoff.ownership.generation,
              )}
              source={{ uri: handoff.banner.imageUrl }}
              style={[styles.image, { backgroundColor: theme.colors.panelSoft }]}
              contentFit="cover"
              onDisplay={() => handleInstanceDisplay(
                "handoff",
                handoff.banner,
                handoff.ownership,
              )}
              onError={() => handleImageError(handoff.banner.id)}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function BannerSlide({
  banner,
  width,
  active,
  role,
  suppressPress,
  onLoad,
  onLoadStart,
  onDisplay,
  displayOwnership,
  onError,
}: {
  banner: DisplayBanner;
  width?: number;
  active: boolean;
  role: "previous" | "current" | "next";
  suppressPress: boolean;
  onLoad: (id: number) => void;
  onLoadStart: (role: "previous" | "current" | "next", banner: DisplayBanner) => void;
  onDisplay: (
    role: BannerInstanceRole,
    banner: DisplayBanner,
    ownership?: BannerTransitionOwnership,
  ) => void;
  displayOwnership?: BannerTransitionOwnership;
  onError: (id: number) => void;
}) {
  const theme = useTheme();
  const link = classifyAdLink(banner.link_url);
  const image = (
    <Image
      key={createBannerImageInstanceKey(role, banner.id, banner.imageUrl)}
      recyclingKey={createBannerImageInstanceKey(role, banner.id, banner.imageUrl)}
      source={{ uri: banner.imageUrl }}
      style={[styles.image, { backgroundColor: theme.colors.panelSoft }]}
      contentFit="cover"
      accessible={active && !link}
      accessibilityLabel={active && !link ? banner.title : undefined}
      accessibilityRole={active && !link ? "image" : undefined}
      onLoadStart={() => onLoadStart(role, banner)}
      onLoad={() => onLoad(banner.id)}
      onDisplay={() => onDisplay(role, banner, displayOwnership)}
      onError={() => onError(banner.id)}
    />
  );

  return (
    <View
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
      style={[styles.slide, width ? { width } : null]}
    >
      {active && link ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={banner.title}
          onPress={() => {
            if (!suppressPress) openAdLink(link);
          }}
          style={styles.pressable}
        >
          {image}
        </Pressable>
      ) : image}
    </View>
  );
}

function openAdLink(link: NonNullable<ReturnType<typeof classifyAdLink>>) {
  if (link.kind === "internal") {
    router.push(link.href as Href);
    return;
  }

  void Linking.canOpenURL(link.href)
    .then((supported) => supported ? Linking.openURL(link.href) : undefined)
    .catch(() => undefined);
}

const styles = StyleSheet.create({
  placement: {
    width: "100%",
    marginTop: 8,
  },
  frame: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  skeleton: {
    opacity: 0.7,
  },
  pressable: {
    flex: 1,
  },
  track: {
    height: "100%",
    flexDirection: "row",
  },
  slide: {
    flex: 1,
    height: "100%",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  handoff: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
  hiddenHandoff: {
    opacity: 0,
  },
});
