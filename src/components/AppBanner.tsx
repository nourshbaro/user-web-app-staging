import { colors, useTheme } from "@/components/ui";
import {
  classifyBannerSwipe,
  isHorizontalBannerGesture,
  normalizeBannerIndex,
  type BannerSwipeDirection,
} from "@/lib/appBannerCarousel";
import { classifyAdLink, resolveAdImageUrl } from "@/lib/adUrls";
import { APP_BANNER_REQUEST_KEY, adsService } from "@/services/ads";
import type { AppBannerAd } from "@/types/ads";
import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  type LayoutChangeEvent,
  Linking,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

const ROTATION_INTERVAL_MS = 10_000;
const SLIDE_DURATION_MS = 360;
const SNAP_BACK_DURATION_MS = 220;
const PRESS_RESET_DELAY_MS = 80;

type DisplayBanner = AppBannerAd & {
  imageUrl: string;
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
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.frame,
          styles.skeleton,
          { backgroundColor: theme.colors.panelSoft, borderColor: theme.colors.line },
        ]}
      />
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
  const dragX = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const animatingRef = useRef(false);
  const mountedRef = useRef(true);
  const suppressPressRef = useRef(false);
  const pressResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      animationRef.current?.stop();
      if (pressResetTimerRef.current) clearTimeout(pressResetTimerRef.current);
      appStateSubscription.remove();
      screenReaderSubscription.remove();
      reduceMotionSubscription.remove();
    };
  }, []);

  const releasePressSuppression = useCallback(() => {
    if (pressResetTimerRef.current) clearTimeout(pressResetTimerRef.current);
    pressResetTimerRef.current = setTimeout(() => {
      suppressPressRef.current = false;
      pressResetTimerRef.current = null;
    }, PRESS_RESET_DELAY_MS);
  }, []);

  const stopAnimation = useCallback(() => {
    animationRef.current?.stop();
    animationRef.current = null;
    animatingRef.current = false;
  }, []);

  const moveToIndex = useCallback((
    targetIndex: number,
    direction: BannerSwipeDirection,
    manual: boolean,
  ) => {
    if (!availableBanners.length || animatingRef.current) return;
    const normalizedTarget = normalizeBannerIndex(targetIndex, availableBanners.length);

    if (manual) setTimerResetKey((value) => value + 1);
    if (normalizedTarget === safeActiveIndex) {
      dragX.setValue(0);
      return;
    }

    const duration = reduceMotionEnabled || screenReaderEnabled ? 0 : SLIDE_DURATION_MS;
    const destination = direction === "next" ? -viewportWidth : viewportWidth;
    animatingRef.current = true;
    animationRef.current = Animated.timing(dragX, {
      toValue: destination,
      duration,
      useNativeDriver: true,
    });
    animationRef.current.start(({ finished }) => {
      animationRef.current = null;
      animatingRef.current = false;
      dragX.setValue(0);
      if (finished && mountedRef.current) setActiveIndex(normalizedTarget);
    });
  }, [
    availableBanners.length,
    dragX,
    reduceMotionEnabled,
    safeActiveIndex,
    screenReaderEnabled,
    viewportWidth,
  ]);

  const snapBack = useCallback(() => {
    stopAnimation();
    animationRef.current = Animated.timing(dragX, {
      toValue: 0,
      duration: reduceMotionEnabled || screenReaderEnabled ? 0 : SNAP_BACK_DURATION_MS,
      useNativeDriver: true,
    });
    animationRef.current.start(() => {
      animationRef.current = null;
      animatingRef.current = false;
    });
  }, [dragX, reduceMotionEnabled, screenReaderEnabled, stopAnimation]);

  useEffect(() => {
    if (
      availableBanners.length <= 1
      || !viewportWidth
      || !appIsActive
      || screenReaderEnabled
      || reduceMotionEnabled
    ) {
      return;
    }

    const timer = setTimeout(() => {
      moveToIndex(safeActiveIndex + 1, "next", false);
    }, ROTATION_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [
    appIsActive,
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
    setFailedIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
    setTimerResetKey((value) => value + 1);
  }, [dragX, stopAnimation]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => (
      availableBanners.length > 1
      && !screenReaderEnabled
      && !animatingRef.current
      && isHorizontalBannerGesture(gesture.dx, gesture.dy)
    ),
    onMoveShouldSetPanResponderCapture: (_, gesture) => (
      availableBanners.length > 1
      && !screenReaderEnabled
      && !animatingRef.current
      && isHorizontalBannerGesture(gesture.dx, gesture.dy)
    ),
    onPanResponderGrant: () => {
      suppressPressRef.current = true;
      stopAnimation();
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
        moveToIndex(safeActiveIndex + 1, direction, true);
      } else if (direction === "previous") {
        moveToIndex(safeActiveIndex - 1, direction, true);
      } else {
        setTimerResetKey((value) => value + 1);
        snapBack();
      }
      releasePressSuppression();
    },
    onPanResponderTerminate: () => {
      setTimerResetKey((value) => value + 1);
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
    stopAnimation,
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

  const handleDotPress = (index: number) => {
    if (index === safeActiveIndex || animatingRef.current) return;
    moveToIndex(index, index > safeActiveIndex ? "next" : "previous", true);
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
              banner={previousBanner}
              width={viewportWidth}
              active={false}
              suppressPressRef={suppressPressRef}
              onError={handleImageError}
            />
            <BannerSlide
              banner={banner}
              width={viewportWidth}
              active
              suppressPressRef={suppressPressRef}
              onError={handleImageError}
            />
            <BannerSlide
              banner={nextBanner}
              width={viewportWidth}
              active={false}
              suppressPressRef={suppressPressRef}
              onError={handleImageError}
            />
          </Animated.View>
        ) : (
          <BannerSlide
            banner={banner}
            active
            suppressPressRef={suppressPressRef}
            onError={handleImageError}
          />
        )}
      </View>

      {availableBanners.length > 1 ? (
        <View style={styles.pagination}>
          {availableBanners.map((item, index) => {
            const active = index === safeActiveIndex;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Show banner ${index + 1} of ${availableBanners.length}`}
                accessibilityState={{ selected: active }}
                onPress={() => handleDotPress(index)}
                style={styles.dotTarget}
              >
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: active ? theme.colors.primary : theme.colors.line },
                    active && styles.activeDot,
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function BannerSlide({
  banner,
  width,
  active,
  suppressPressRef,
  onError,
}: {
  banner: DisplayBanner;
  width?: number;
  active: boolean;
  suppressPressRef: React.RefObject<boolean>;
  onError: (id: number) => void;
}) {
  const link = classifyAdLink(banner.link_url);
  const image = (
    <Image
      source={{ uri: banner.imageUrl }}
      style={styles.image}
      contentFit="cover"
      accessible={active && !link}
      accessibilityLabel={active && !link ? banner.title : undefined}
      accessibilityRole={active && !link ? "image" : undefined}
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
            if (!suppressPressRef.current) openAdLink(link);
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
    backgroundColor: colors.panelSoft,
  },
  pagination: {
    minHeight: 44,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
  },
  dotTarget: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  activeDot: {
    width: 18,
  },
});
