/**
 * `AppText` base style. Pure module (no React Native imports), so the
 * renderer diff can be tested under Node.
 *
 * Optional processed keys (`fontVariant`, `textTransform`) are only included
 * when set, never written as `key: undefined`: React Native's style diff
 * passes an explicit `undefined` to the key's processor as `null`, and
 * `processFontVariant(null)` throws (the same class of crash as the filter
 * chips' `transform`).
 */
import type { FontWeight } from "@/lib/fontFamilies";

type Token = { fontSize: number; fontVariant?: readonly "tabular-nums"[]; uppercase?: boolean };

export function appTextBaseStyle({
  token,
  lineHeight,
  fontStyle,
  color,
  align,
  latin,
}: {
  token: Token;
  lineHeight: number;
  fontStyle: { fontFamily: string } | { fontWeight: FontWeight };
  color: string;
  align: "start" | "center";
  latin: boolean;
}) {
  return {
    fontSize: token.fontSize,
    lineHeight,
    ...fontStyle,
    ...(token.fontVariant ? { fontVariant: [...token.fontVariant] } : null),
    color,
    textAlign: align === "center" ? ("center" as const) : ("auto" as const),
    writingDirection: latin ? ("ltr" as const) : ("rtl" as const),
    // Uppercase display titles are Latin-only: Arabic script has no case.
    ...(token.uppercase && latin ? { textTransform: "uppercase" as const } : null),
  };
}
