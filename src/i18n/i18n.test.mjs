import assert from "node:assert/strict";
import test from "node:test";
import { directionalChevron, PHYSICAL_LAYOUT_STYLE } from "./direction.ts";
import {
  DEFAULT_LOCALE,
  ENABLED_LOCALES,
  LOCALE_META,
  isEnabledLocale,
  resolveAppLocale,
} from "./locales.ts";
import { en } from "./messages/en.ts";
import { pluralSelectorFor } from "./pluralRules.ts";
import { createTranslator, interpolate } from "./translate.ts";

test("English is the default and exactly English and Arabic are enabled", () => {
  assert.equal(DEFAULT_LOCALE, "en");
  assert.deepEqual([...ENABLED_LOCALES], ["en", "ar"]);
  assert.equal(isEnabledLocale("ar"), true);
  assert.equal(LOCALE_META.ar.direction, "rtl");
  assert.equal(LOCALE_META.en.direction, "ltr");
});

test("stored preferences resolve safely to an enabled locale", () => {
  assert.equal(resolveAppLocale("en"), "en");
  assert.equal(resolveAppLocale("ar"), "ar", "a saved Arabic preference must activate");
  assert.equal(resolveAppLocale(null), "en");
  assert.equal(resolveAppLocale("fr"), "en");
  assert.equal(resolveAppLocale(42), "en");
});

test("the English catalog has no empty strings and every plural family has an .other form", () => {
  for (const [key, value] of Object.entries(en)) {
    assert.ok(value.trim().length > 0, `${key} is empty`);
    const family = key.match(/^(.*)\.(zero|one|two|few|many)$/);
    if (family) assert.ok(`${family[1]}.other` in en, `${family[1]} lacks .other`);
  }
});

test("interpolation replaces known placeholders and leaves unknown ones visible", () => {
  assert.equal(interpolate("{count} tickets", { count: 3 }), "3 tickets");
  assert.equal(interpolate("Hi {name}", {}), "Hi {name}");
  assert.equal(interpolate("No params"), "No params");
});

test("translator falls back to the reference catalog, then to the key", () => {
  const { t } = createTranslator({ selectPlural: pluralSelectorFor("ar-LB"), messages: { "common.retry": "أعد المحاولة" }, fallback: en });
  assert.equal(t("common.retry"), "أعد المحاولة");
  assert.equal(t("common.close"), "Close");
  assert.equal(t("missing.key"), "missing.key");
});

test("plurals follow the locale's CLDR categories", () => {
  const english = createTranslator({ selectPlural: pluralSelectorFor("en-US"), messages: en, fallback: en });
  assert.equal(english.plural("transaction.ticketCount", 1), "1 ticket");
  assert.equal(english.plural("transaction.ticketCount", 4), "4 tickets");

  const arabic = createTranslator({
    selectPlural: pluralSelectorFor("ar-LB"),
    messages: { "transaction.ticketCount.two": "تذكرتان", "transaction.ticketCount.other": "{count} تذكرة" },
    fallback: en,
  });
  assert.equal(arabic.plural("transaction.ticketCount", 2), "تذكرتان");
  assert.equal(arabic.plural("transaction.ticketCount", 100), "100 تذكرة");
});

test("the plural count argument is authoritative for both selection and interpolation", () => {
  const english = createTranslator({ selectPlural: pluralSelectorFor("en-US"), messages: en, fallback: en });
  assert.equal(english.plural("transaction.ticketCount", 1), "1 ticket");
  assert.equal(english.plural("transaction.ticketCount", 2), "2 tickets");
  // A conflicting params.count (rejected at compile time) cannot change the rendered count at runtime.
  assert.equal(english.plural("transaction.ticketCount", 1, { count: 2 }), "1 ticket");
  assert.equal(english.plural("transaction.ticketCount", 2, { count: 1 }), "2 tickets");
});

test("directional chevrons mirror only for RTL; physical layouts pin LTR", () => {
  assert.equal(directionalChevron("forward", false).ios, "chevron.right");
  assert.equal(directionalChevron("forward", true).ios, "chevron.left");
  assert.equal(directionalChevron("back", false).android, "chevron_left");
  assert.equal(directionalChevron("back", true).android, "chevron_right");
  assert.deepEqual(PHYSICAL_LAYOUT_STYLE, { direction: "ltr" });
});
