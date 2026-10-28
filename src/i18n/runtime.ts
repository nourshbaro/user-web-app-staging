import { getAppLocale, localeMeta } from "./locales.ts";
import { en } from "./messages/en.ts";
import { ar } from "./messages/ar.ts";
import { pluralSelectorFor } from "./pluralRules.ts";
import { createTranslator, type MessageParams } from "./translate.ts";
import type { MessageKey } from "./messages/en.ts";

const translators = {
  en: createTranslator({ messages: en, fallback: en, selectPlural: pluralSelectorFor(localeMeta("en").tag) }),
  ar: createTranslator({ messages: ar, fallback: en, selectPlural: pluralSelectorFor(localeMeta("ar").tag) }),
};

/** Non-React presentation helpers use the provider's live selection. */
export function translate(key: MessageKey, params?: MessageParams) {
  return translators[getAppLocale()].t(key, params);
}
