import assert from "node:assert/strict";
import test from "node:test";
import { OFFICIAL_CONTACTS } from "./contact.ts";

test("official contact destinations remain centralized and allowlisted", () => {
  assert.deepEqual(
    OFFICIAL_CONTACTS.map(({ label, url }) => [label, url]),
    [
      ["Instagram", "https://www.instagram.com/thelfadotcom/"],
      ["Facebook", "https://www.facebook.com/thelfadotcom"],
      ["X", "https://x.com/thelfadotcom"],
      ["Email", "mailto:info%40lfa-ticketing.com"],
    ],
  );
});

test("social contacts use real brand glyph authorities instead of generic substitutes", () => {
  assert.deepEqual(
    OFFICIAL_CONTACTS.slice(0, 3).map(({ label, brand }) => [label, brand]),
    [["Instagram", "instagram"], ["Facebook", "facebook"], ["X", "x"]],
  );
  assert.deepEqual(OFFICIAL_CONTACTS[3].icon, { ios: "envelope", android: "mail", web: "mail" });
});
