import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { LOCALE_META } from "./locales.ts";
import { en } from "./messages/en.ts";
import { hasPluralRules, pluralSelectorFor } from "./pluralRules.ts";
import { createTranslator } from "./translate.ts";

const samples = [
  ...Array.from({ length: 1201 }, (_, index) => index),
  -1, -2, -11, 0.5, 1.5, 2.5, 3.25, 10.1, 101.5,
];

// Node ships full ICU; Hermes does not. Use Node's Intl only as the reference oracle.
for (const language of ["en", "ar"]) {
  test(`${language} plural rules match full ICU for integers and fractions`, () => {
    const reference = new Intl.PluralRules(language);
    const select = pluralSelectorFor(language);
    for (const count of samples) {
      assert.equal(select(count), reference.select(count), `${language} ${count}`);
    }
  });
}

test("every declared app locale has plural rules; unknown ones fail loudly", () => {
  for (const meta of Object.values(LOCALE_META)) assert.ok(hasPluralRules(meta.tag), meta.tag);
  assert.throws(() => pluralSelectorFor("fr-FR"), /No CLDR plural rules/);
});

test("translator works in a runtime without Intl.PluralRules (Hermes)", () => {
  const original = Intl.PluralRules;
  // Simulate Hermes: the constructor is absent.
  Object.defineProperty(Intl, "PluralRules", { value: undefined, configurable: true, writable: true });
  try {
    assert.equal(typeof Intl.PluralRules, "undefined");
    const { t, plural } = createTranslator({ messages: en, fallback: en, selectPlural: pluralSelectorFor("en-US") });
    assert.equal(t("common.retry"), "Try again");
    assert.equal(plural("transaction.ticketCount", 1), "1 ticket");
    assert.equal(plural("transaction.ticketCount", 0), "0 tickets");
    assert.equal(plural("transaction.ticketCount", 2), "2 tickets");
    assert.equal(plural("transaction.ticketCount", 1, { count: 5 }), "1 ticket");

    const arabic = createTranslator({
      messages: { "transaction.ticketCount.zero": "لا تذاكر", "transaction.ticketCount.few": "{count} تذاكر", "transaction.ticketCount.other": "{count} تذكرة" },
      fallback: en,
      selectPlural: pluralSelectorFor("ar-LB"),
    });
    assert.equal(arabic.plural("transaction.ticketCount", 0), "لا تذاكر");
    assert.equal(arabic.plural("transaction.ticketCount", 5), "5 تذاكر");
  } finally {
    Object.defineProperty(Intl, "PluralRules", { value: original, configurable: true, writable: true });
  }
});

test("startup translation code never touches engine-dependent Intl constructors", async () => {
  for (const file of ["./translate.ts", "./pluralRules.ts", "./locales.ts", "./direction.ts", "./directionTransition.ts"]) {
    const source = (await readFile(new URL(file, import.meta.url), "utf8"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(source, /\bIntl\./, `${file} must not use Intl at runtime`);
  }
  const provider = await readFile(new URL("./I18nProvider.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(provider, /new Intl\./);
});
