/**
 * App-language source of truth. Pure module (no React Native imports).
 *
 * The app language is an explicit app setting — never inferred from the
 * device — so text, direction and formatting always agree. A locale is only
 * selectable once it is listed in ENABLED_LOCALES, which requires a complete,
 * reviewed catalog. Arabic is declared for layout/formatting readiness but is
 * NOT enabled: no Arabic translation exists yet.
 */

export type AppLocale = "en" | "ar";
export type TextDirection = "ltr" | "rtl";
export type Script = "latin" | "arabic";

export type LocaleMeta = {
  /** BCP-47 tag used for Intl formatting. */
  tag: string;
  direction: TextDirection;
  script: Script;
  /** The language's own name, for a future language picker. */
  nativeName: string;
};

export const LOCALE_META: Record<AppLocale, LocaleMeta> = {
  en: { tag: "en-US", direction: "ltr", script: "latin", nativeName: "English" },
  // Numerals (Arabic-Indic vs Latin digits) are an open product decision;
  // until decided, "ar-LB" keeps ICU's default for Lebanon.
  ar: { tag: "ar-LB", direction: "rtl", script: "arabic", nativeName: "العربية" },
};

export const DEFAULT_LOCALE: AppLocale = "en";
export const ENABLED_LOCALES: readonly AppLocale[] = ["en"];
export const LOCALE_STORAGE_KEY = "lfa_locale";

export function isEnabledLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (ENABLED_LOCALES as readonly string[]).includes(value);
}

/** Resolves a persisted preference; anything unknown or not yet enabled falls back to the default. */
export function resolveAppLocale(stored: unknown): AppLocale {
  return isEnabledLocale(stored) ? stored : DEFAULT_LOCALE;
}

export function localeMeta(locale: AppLocale): LocaleMeta {
  return LOCALE_META[locale];
}
