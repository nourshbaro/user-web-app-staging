import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentSource = await readFile(
  new URL("./InternationalPhoneInput.tsx", import.meta.url),
  "utf8",
);

test("closed phone-country selector displays the country name before its calling code", () => {
  assert.match(
    componentSource,
    /styles\.countryCode[\s\S]*?\{phoneCountryName\}[\s\S]*?styles\.callingCode/,
  );
  assert.doesNotMatch(
    componentSource,
    /styles\.countryCode[\s\S]{0,200}?\{value\.phoneCountry\}/,
  );
});
