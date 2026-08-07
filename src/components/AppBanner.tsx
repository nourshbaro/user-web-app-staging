import { useTheme } from "@/components/ui";
import { classifyAdLink, resolveAdImageUrl } from "@/lib/adUrls";
import {
  classifyBannerSwipe,
  isHorizontalBannerGesture,
  normalizeBannerIndex,
  shouldAutoRotateBanners,
  type BannerSwipeDirection,
} from "@/lib/appBannerCarousel";
import { APP_BANNER_REQUEST_KEY, adsService } from "@/services/ads";
import type { AppBannerAd } from "@/types/ads";
import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  const [loadedIds, setLoadedIds] = useState<Set<number>>(() => new Set());
  const [handoff, setHandoff] = useState<BannerHandoff | null>(null);
  const [dragX] = useState(() => new Animated.Value(0));
  const transitionInProgressRef = useRef(false);
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

  useLayoutEffect(() => {
    if (!handoff) return;

    if (safeActiveIndex !== handoff.targetIndex) {
      const commitFrame = requestAnimationFrame(() => {
        if (mountedRef.current) setActiveIndex(handoff.targetIndex);
      });
      return () => cancelAnimationFrame(commitFrame);
    }
    dragX.setValue(0);
    const frame = requestAnimationFrame(() => {
      if (mountedRef.current) {
        setHandoff(null);
        setAnimating(false);
        transitionInProgressRef.current = false;
        setTimerResetKey((value) => value + 1);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [dragX, handoff, safeActiveIndex]);

  const releasePressSuppression = useCallback(() => {
    setSuppressPress(false);
  }, []);

  const stopAnimation = useCallback(() => {
    dragX.stopAnimation();
    transitionInProgressRef.current = false;
    setAnimating(false);
  }, [dragX]);

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

    if (normalizedTarget === safeActiveIndex) {
      dragX.setValue(0);
      return;
    }
    if (!destinationBanner || !loadedIds.has(destinationBanner.id)) {
      dragX.setValue(0);
      setTimerResetKey((value) => value + 1);
      return;
    }

    const duration = reduceMotionEnabled || screenReaderEnabled ? 0 : SLIDE_DURATION_MS;
    const destination = direction === "next" ? -viewportWidth : viewportWidth;
    transitionInProgressRef.current = true;
    setAnimating(true);
    Animated.timing(dragX, {
      toValue: destination,
      duration,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || !mountedRef.current) {
        transitionInProgressRef.current = false;
        setAnimating(false);
        return;
      }
      setHandoff({ banner: destinationBanner, targetIndex: normalizedTarget });
    });
  }, [
    availableBanners,
    dragX,
    loadedIds,
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
    stopAnimation();
    dragX.setValue(0);
    setHandoff(null);
    const remainingBanners = availableBanners.filter((item) => item.id !== id);
    const nextActiveIndex = id === banner?.id
      ? normalizeBannerIndex(safeActiveIndex, remainingBanners.length)
      : Math.max(0, remainingBanners.findIndex((item) => item.id === banner?.id));
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
  }, [availableBanners, banner?.id, dragX, safeActiveIndex, stopAnimation]);

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
      if (!reduceMotionEnabled) dragX.setValue(gesture.dx);
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
    moveToIndex,
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
              suppressPress={suppressPress}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
            <BannerSlide
              key="current"
              banner={banner}
              width={viewportWidth}
              active
              suppressPress={suppressPress}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
            <BannerSlide
              key="next"
              banner={nextBanner}
              width={viewportWidth}
              active={false}
              suppressPress={suppressPress}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
          </Animated.View>
        ) : (
          <BannerSlide
            banner={banner}
            active
            suppressPress={suppressPress}
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        )}
        {handoff ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={styles.handoff}
          >
            <Image
              source={{ uri: handoff.banner.imageUrl }}
              style={[styles.image, { backgroundColor: theme.colors.panelSoft }]}
              contentFit="cover"
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
  suppressPress,
  onLoad,
  onError,
}: {
  banner: DisplayBanner;
  width?: number;
  active: boolean;
  suppressPress: boolean;
  onLoad: (id: number) => void;
  onError: (id: number) => void;
}) {
  const theme = useTheme();
  const link = classifyAdLink(banner.link_url);
  const image = (
    <Image
      source={{ uri: banner.imageUrl }}
      style={[styles.image, { backgroundColor: theme.colors.panelSoft }]}
      contentFit="cover"
      accessible={active && !link}
      accessibilityLabel={active && !link ? banner.title : undefined}
      accessibilityRole={active && !link ? "image" : undefined}
      onLoad={() => onLoad(banner.id)}
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
  },
});
