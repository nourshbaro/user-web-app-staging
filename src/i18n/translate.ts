/**
 * Pure translation engine (no React, no React Native, no engine globals) so
 * it is unit-testable and safe to construct during startup on every JS engine.
 * Catalogs and the plural selector are passed in; lookups fall back to the
 * reference catalog, then to the key itself, so a missing translation is
 * visible but never crashes.
 */
import type { MessageKey } from "./messages/en";
import type { PluralSelector } from "./pluralRules";

export type MessageParams = Record<string, string | number>;

/** Keys that exist only as plural families (`<base>.one`, `<base>.other`, …). */
type PluralBase<K extends string> = K extends `${infer Base}.other` ? Base : never;
export type PluralKey = PluralBase<MessageKey>;

/** Extra plural placeholders; `count` is reserved for the authoritative count argument. */
export type PluralParams = MessageParams & { count?: never };

export type Translator = {
  t: (key: MessageKey, params?: MessageParams) => string;
  plural: (key: PluralKey, count: number, params?: PluralParams) => string;
};

export function interpolate(template: string, params?: MessageParams) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

export function createTranslator({
  messages,
  fallback,
  selectPlural,
}: {
  messages: Partial<Record<string, string>>;
  fallback: Partial<Record<string, string>>;
  /** From `pluralSelectorFor(localeTag)` — engine-independent CLDR rules (Hermes has no Intl.PluralRules). */
  selectPlural: PluralSelector;
}): Translator {
  const lookup = (key: string) => messages[key] ?? fallback[key];

  const t = (key: MessageKey, params?: MessageParams) =>
    interpolate(lookup(key) ?? key, params);

  const plural = (key: PluralKey, count: number, params?: PluralParams) => {
    const category = selectPlural(count);
    const template =
      lookup(`${key}.${category}`) ??
      lookup(`${key}.other`) ??
      `${key}.other`;
    // `count` is spread last so the value used for selection is the value shown.
    return interpolate(template, { ...params, count });
  };

  return { t, plural };
}
