import assert from "node:assert/strict";
import test from "node:test";
import { OFFICIAL_CONTACTS } from "./contact.ts";

test("official contact destinations remain centralized and allowlisted", () => {
  assert.deepEqual(
    OFFICIAL_CONTACTS.map(({ label, url }) => [label, url]),
    // Product decision: Instagram, Facebook and X are intentionally not offered.
    [
      ["WhatsApp", "https://wa.me/96170447888"],
      ["Email", "mailto:info%40lfa-ticketing.com"],
    ],
  );
});

test("WhatsApp uses its real brand glyph authority and Email uses the mail symbol", () => {
  assert.deepEqual(
    OFFICIAL_CONTACTS.map(({ label, brand }) => [label, brand]),
    [["WhatsApp", "whatsapp"], ["Email", undefined]],
  );
  assert.equal(OFFICIAL_CONTACTS[0].appUrl, "whatsapp://send?phone=96170447888");
  assert.equal(OFFICIAL_CONTACTS[0].accessibilityLabel, "Contact us on WhatsApp");
  assert.deepEqual(OFFICIAL_CONTACTS[1].icon, { ios: "envelope", android: "mail", web: "mail" });
});

test("profile tries the WhatsApp app before the web fallback", async () => {
  const profile = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../app/profile.tsx", import.meta.url), "utf8"),
  );

  assert.match(profile, /Platform\.OS !== "web"/);
  assert.match(profile, /await Linking\.openURL\(contact\.appUrl\)/);
  assert.match(profile, /await Linking\.openURL\(contact\.url\)/);
  assert.match(profile, /toast\.showToast\(\{/);
});
