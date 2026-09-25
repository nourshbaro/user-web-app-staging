/**
 * Engine-independent CLDR cardinal plural rules (pure module).
 *
 * Why not `Intl.PluralRules`: Hermes (the native JS engine) does not provide
 * it, so constructing it at startup crashes native apps while Node/web pass.
 * These rules are the CLDR definitions for every language in `LOCALE_META`,
 * verified against full ICU in `pluralRules.test.mjs`.
 *
 * Extension boundary: adding an app language requires adding its CLDR rule
 * here (unsupported languages fail loudly in `pluralSelectorFor`).
 */

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
export type PluralSelector = (count: number) => PluralCategory;

// en — one: i = 1 and v = 0; other: everything else.
const english: PluralSelector = (count) => {
  const n = Math.abs(count);
  return n === 1 ? "one" : "other";
};

// ar — zero: n = 0; one: n = 1; two: n = 2; few: n % 100 = 3..10;
// many: n % 100 = 11..99; other: everything else (including fractions).
const arabic: PluralSelector = (count) => {
  const n = Math.abs(count);
  if (!Number.isInteger(n)) return "other";
  if (n === 0) return "zero";
  if (n === 1) return "one";
  if (n === 2) return "two";
  const mod100 = n % 100;
  if (mod100 >= 3 && mod100 <= 10) return "few";
  if (mod100 >= 11 && mod100 <= 99) return "many";
  return "other";
};

const RULES: Record<string, PluralSelector> = { en: english, ar: arabic };

export function hasPluralRules(localeTag: string) {
  return Object.prototype.hasOwnProperty.call(RULES, localeTag.split("-")[0].toLowerCase());
}

export function pluralSelectorFor(localeTag: string): PluralSelector {
  const language = localeTag.split("-")[0].toLowerCase();
  const selector = RULES[language];
  if (!selector) {
    throw new Error(`No CLDR plural rules for "${localeTag}". Add them to src/i18n/pluralRules.ts before enabling this locale.`);
  }
  return selector;
}
