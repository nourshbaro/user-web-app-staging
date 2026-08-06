import type { BlueNavigationDecision as CoreBlueNavigationDecision, BlueTerminalResult } from "@/lib/bluePaymentRedirect";

const SAFE_CALLBACKS = new Set([
  "onShouldStartLoadWithRequest",
  "Linking.canOpenURL",
  "Linking.openURL",
]);
const SAFE_NAVIGATION_TYPES = new Set([
  "click",
  "formsubmit",
  "backforward",
  "reload",
  "formresubmit",
  "other",
]);
const HOST_SCHEMES = new Set(["http", "https", "exp", "lfa-app"]);
const MAX_SCHEME_LENGTH = 32;
const MAX_HOST_LENGTH = 100;

export type BlueNavigationDecision =
  | "navigation_received"
  | CoreBlueNavigationDecision
  | "open_external_supported"
  | "external_open_failed";

export type BlueNavigationDiagnostic = {
  callback: string;
  scheme: string;
  host: string | null;
  pathShape: string;
  navigationType: string;
  isTopFrame: boolean | null;
  terminalResult: BlueTerminalResult | "none";
  terminalAlreadyHandled: boolean;
  decision: BlueNavigationDecision;
};

type DiagnosticContext = {
  callback: string;
  navigationType?: string;
  isTopFrame?: boolean;
  terminalResult?: BlueTerminalResult | null;
  terminalAlreadyHandled: boolean;
  decision: BlueNavigationDecision;
};

function safeScheme(value: string) {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  return match ? match[1].toLowerCase().slice(0, MAX_SCHEME_LENGTH) : "invalid";
}

function safePathShape(url: URL, scheme: string) {
  if (scheme === "intent") return "/<redacted>";

  const path = url.pathname;
  if (path === "/payment/success") return path;
  if (path === "/payment/failed") return path;
  if (path === "/" || path === "") return "/";
  if (path === "/payment" || path.startsWith("/payment/")) return "/payment/<redacted>";
  if (path === "/--" || path.startsWith("/--/")) return "/--/<redacted>";
  return "/<redacted>";
}

export function createBlueNavigationDiagnostic(
  rawNavigationUrl: string,
  context: DiagnosticContext,
): BlueNavigationDiagnostic {
  const scheme = safeScheme(rawNavigationUrl);
  const base = {
    callback: SAFE_CALLBACKS.has(context.callback) ? context.callback : "unknown",
    scheme,
    navigationType: context.navigationType && SAFE_NAVIGATION_TYPES.has(context.navigationType)
      ? context.navigationType
      : "unknown",
    isTopFrame: typeof context.isTopFrame === "boolean" ? context.isTopFrame : null,
    terminalResult: context.terminalResult ?? "none",
    terminalAlreadyHandled: context.terminalAlreadyHandled,
    decision: context.decision,
  } satisfies Omit<BlueNavigationDiagnostic, "host" | "pathShape">;

  try {
    const url = new URL(rawNavigationUrl);
    const host = HOST_SCHEMES.has(scheme) && url.hostname
      ? url.hostname.toLowerCase().slice(0, MAX_HOST_LENGTH)
      : null;
    return {
      ...base,
      host,
      pathShape: safePathShape(url, scheme),
    };
  } catch {
    return {
      ...base,
      host: null,
      pathShape: "/<invalid>",
    };
  }
}

export function terminalHandledDecision(terminalAlreadyHandled: boolean) {
  return terminalAlreadyHandled ? "ignored_after_terminal" as const : null;
}

export function logBlueNavigationDiagnostic(metadata: BlueNavigationDiagnostic) {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  if (typeof console === "undefined" || typeof console.info !== "function") return;
  console.info("Blue payment navigation", metadata);
}
