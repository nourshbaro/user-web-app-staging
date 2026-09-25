import {
  DIRECTION_ATTEMPT_STORAGE_KEY,
  parseDirectionAttempt,
  planDirection,
  serializeDirectionAttempt,
  type Direction,
} from "@/i18n/directionTransition";
import { en } from "@/i18n/messages/en";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  localeMeta,
  resolveAppLocale,
  type AppLocale,
  type LocaleMeta,
} from "@/i18n/locales";
import { pluralSelectorFor } from "@/i18n/pluralRules";
import { createTranslator, type Translator } from "@/i18n/translate";
import { formatDate, formatDateTime, formatMoney, formatTime, setFormatLocale } from "@/lib/format";
import { storage } from "@/lib/storage";
import { darkColors, lightColors } from "@/lib/themePalette";
import { reloadAppAsync } from "expo";
import * as SplashScreen from "expo-splash-screen";
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { I18nManager, Platform, Pressable, Text, useColorScheme, View } from "react-native";

// Only enabled locales need a catalog here; add `ar` when its translation is complete.
const CATALOGS: Partial<Record<AppLocale, Partial<Record<string, string>>>> = { en };

/** If a requested reload has not replaced this runtime by then, stop waiting. */
const RELOAD_TIMEOUT_MS = 4000;

type Phase = "loading" | "reloading" | "restart-required" | "ready";

type I18nContextValue = Translator & {
  locale: AppLocale;
  meta: LocaleMeta;
  /** Only ever true/false for a direction that is actually active in the layout. */
  isRTL: boolean;
  isReady: boolean;
  formatDate: typeof formatDate;
  formatTime: typeof formatTime;
  formatDateTime: typeof formatDateTime;
  formatMoney: typeof formatMoney;
};

function buildValue(locale: AppLocale, isReady: boolean): I18nContextValue {
  const meta = localeMeta(locale);
  const translator = createTranslator({
    messages: CATALOGS[locale] ?? en,
    fallback: en,
    selectPlural: pluralSelectorFor(meta.tag),
  });
  return {
    ...translator,
    locale,
    meta,
    isRTL: meta.direction === "rtl",
    isReady,
    formatDate,
    formatTime,
    formatDateTime,
    formatMoney,
  };
}

function applyNativeDirection(direction: Direction) {
  const rtl = direction === "rtl";
  // Both flags: LTR must also disallow the device-locale RTL fallback.
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
}

/**
 * Resolves the phase in which it is safe to render. Normal content is only
 * rendered when the active native direction equals the app language's.
 */
async function resolveNativeDirection(desired: Direction): Promise<Phase> {
  const active: Direction = I18nManager.isRTL ? "rtl" : "ltr";

  let rawAttempt: string | null;
  try {
    rawAttempt = await storage.get(DIRECTION_ATTEMPT_STORAGE_KEY);
  } catch {
    if (desired === active) return "ready";
    // Unknown attempt history: never auto-reload without a loop guard.
    applyNativeDirection(desired);
    return "restart-required";
  }

  const plan = planDirection({ desired, active, attempt: parseDirectionAttempt(rawAttempt) });

  if (plan.phase === "ready") {
    if (plan.clearAttempt) await storage.remove(DIRECTION_ATTEMPT_STORAGE_KEY).catch(() => {});
    return "ready";
  }

  // Idempotent: persists natively so the next cold start uses the right direction.
  applyNativeDirection(desired);

  if (plan.phase === "restart-required") return "restart-required";

  try {
    await storage.set(DIRECTION_ATTEMPT_STORAGE_KEY, serializeDirectionAttempt(plan.attempt));
  } catch {
    return "restart-required";
  }
  return "reloading";
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocale] = useState<AppLocale>(DEFAULT_LOCALE);
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let active = true;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      const stored = await storage.get(LOCALE_STORAGE_KEY).catch(() => null);
      const nextLocale = resolveAppLocale(stored);
      const meta = localeMeta(nextLocale);
      setFormatLocale(meta.tag);

      let nextPhase: Phase;
      if (Platform.OS === "web") {
        // The DOM applies `dir` immediately; no restart is involved.
        if (typeof document !== "undefined") {
          document.documentElement.dir = meta.direction;
          document.documentElement.lang = meta.tag;
        }
        nextPhase = "ready";
      } else {
        nextPhase = await resolveNativeDirection(meta.direction);
      }
      if (!active) return;

      setLocale(nextLocale);
      setPhase(nextPhase);

      if (nextPhase === "reloading") {
        // reloadAppAsync resolves without reloading when the native hook is
        // unavailable; the timer turns that into the blocking state.
        reloadTimer = setTimeout(() => {
          if (active) setPhase("restart-required");
        }, RELOAD_TIMEOUT_MS);
        reloadAppAsync("Apply app language layout direction").catch(() => {
          if (active) setPhase("restart-required");
        });
      }
    })();

    return () => {
      active = false;
      if (reloadTimer) clearTimeout(reloadTimer);
    };
  }, []);

  const isReady = phase === "ready";
  const value = useMemo(() => buildValue(locale, isReady), [locale, isReady]);

  if (phase === "restart-required") return <DirectionRestartRequired value={value} />;
  // While loading or reloading, nothing (not even providers below) renders; the splash stays up.
  if (!isReady) return null;

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Deterministic blocking state: shown instead of the app when the native
 * direction still differs after the automatic reload. Rendered above the
 * theme and navigation, so it uses the palettes directly.
 */
function DirectionRestartRequired({ value }: { value: I18nContextValue }) {
  const colors = useColorScheme() === "dark" ? darkColors : lightColors;

  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <View style={[local.screen, { backgroundColor: colors.background }]}>
      <View style={[local.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text accessibilityRole="header" style={[local.title, { color: colors.textStrong }]}>
          {value.t("direction.restart.title")}
        </Text>
        <Text style={[local.message, { color: colors.textMuted }]}>{value.t("direction.restart.message")}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={value.t("direction.restart.action")}
          // User-initiated only; the automatic reload budget is already spent.
          onPress={() => void reloadAppAsync("Retry app language layout direction").catch(() => {})}
          style={({ pressed }) => [local.button, { backgroundColor: colors.actionPrimary }, pressed && { opacity: 0.82 }]}
        >
          <Text style={[local.buttonText, { color: colors.onActionPrimary }]}>{value.t("direction.restart.action")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const local = {
  screen: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: 24 },
  card: { width: "100%" as const, maxWidth: 420, borderWidth: 1, borderRadius: 16, padding: 24, gap: 12 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: "800" as const, textAlign: "center" as const },
  message: { fontSize: 15, lineHeight: 22, textAlign: "center" as const },
  button: { minHeight: 48, borderRadius: 12, alignItems: "center" as const, justifyContent: "center" as const, paddingHorizontal: 16 },
  buttonText: { fontSize: 16, fontWeight: "700" as const },
};

const fallbackValue = buildValue(DEFAULT_LOCALE, true);

/** Outside the provider (isolated renders) this returns the English defaults. */
export function useI18n() {
  return useContext(I18nContext) ?? fallbackValue;
}
