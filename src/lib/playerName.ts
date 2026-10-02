/**
 * v3 player-name display: "FirstName LastName" → "F. LastName" (timeline and
 * scorer lines). Presentation only — the backend value is never changed and
 * screen-reader labels keep the full name. Pure module.
 *
 * - every word after the first is kept: "Kassem El Zein" → "K. El Zein";
 * - one word, an already abbreviated first word ("M. Hussein") and
 *   Arabic-script names (no initial convention) are shown as given;
 * - a missing or blank name stays null (nothing is invented).
 */
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export function shortPlayerName(name: string | null | undefined): string | null {
  const trimmed = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!trimmed) return null;
  if (ARABIC_SCRIPT.test(trimmed)) return trimmed;
  const words = trimmed.split(" ");
  if (words.length < 2) return trimmed;
  const [first, ...rest] = words;
  if (first.endsWith(".")) return trimmed;
  const initial = Array.from(first)[0]?.toLocaleUpperCase();
  return initial ? `${initial}. ${rest.join(" ")}` : trimmed;
}
