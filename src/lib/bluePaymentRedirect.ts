export type BlueTerminalResult = "success" | "failed";
export type BlueTerminalContext = "blue-payment-webview";
export type BlueNavigationDecision =
  | "terminal_success"
  | "terminal_failed"
  | "allow_webview_http"
  | "open_external_attempt"
  | "blocked_credentials"
  | "blocked_dangerous_scheme"
  | "blocked_unknown_scheme"
  | "invalid_url"
  | "ignored_after_terminal";
export type BlueNavigationAction =
  | "handle_terminal"
  | "ignore"
  | "allow_webview"
  | "open_external"
  | "block";

const FORBIDDEN_ENCODED_PATH_SEQUENCE = /%(?:2e|2f|5c)/i;
const TERMINAL_PATHS: Record<BlueTerminalResult, string> = {
  success: "/payment/success",
  failed: "/payment/failed",
};
const APP_CALLBACK_PATHS: Record<BlueTerminalResult, string> = {
  success: "/success",
  failed: "/failed",
};
const EXTERNAL_SCHEMES = new Set(["tel:", "mailto:"]);
const REJECTED_SCHEMES = new Set(["file:", "data:", "javascript:", "intent:", "market:"]);

function parseConfiguredOrigin(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:")
      || url.username
      || url.password
      || url.search
      || url.hash
      || (url.pathname !== "/" && url.pathname !== "")
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function validateBluePaymentUrl(value: unknown, allowedOrigin: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Blue returned an empty payment URL.");
  }

  const trustedOrigin = parseConfiguredOrigin(allowedOrigin);
  if (!trustedOrigin) {
    throw new Error("Blue payment is not configured for this environment.");
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Blue returned an invalid payment URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Blue returned an unsupported payment URL.");
  }
  if (url.origin !== trustedOrigin || url.username || url.password || url.hash) {
    throw new Error("Blue returned an untrusted payment URL.");
  }
  if (FORBIDDEN_ENCODED_PATH_SEQUENCE.test(url.pathname)) {
    throw new Error("Blue returned an invalid payment path.");
  }

  const segments = url.pathname.split("/");
  if (segments.length !== 3 || segments[0] !== "" || segments[1] !== "payment" || !segments[2]) {
    throw new Error("Blue returned an invalid payment path.");
  }

  return url.href;
}

export function classifyBlueTerminalUrl(
  value: string,
  redirectOrigin: string,
  context?: BlueTerminalContext,
): BlueTerminalResult | null {
  try {
    const url = new URL(value);

    if (url.protocol === "lfa-app:") {
      if (context !== "blue-payment-webview") return null;
      const callbackWithoutQueryOrFragment = value.split(/[?#]/, 1)[0];
      if (
        url.host !== "checkout"
        || url.username
        || url.password
        || url.hash
        || FORBIDDEN_ENCODED_PATH_SEQUENCE.test(callbackWithoutQueryOrFragment)
        || FORBIDDEN_ENCODED_PATH_SEQUENCE.test(url.pathname)
      ) {
        return null;
      }

      const providers = url.searchParams.getAll("provider");
      if (providers.length > 1 || (providers.length === 1 && providers[0] !== "blue")) return null;
      if (url.pathname === APP_CALLBACK_PATHS.success) return "success";
      if (url.pathname === APP_CALLBACK_PATHS.failed) return "failed";
      return null;
    }

    const trustedOrigin = parseConfiguredOrigin(redirectOrigin);
    if (!trustedOrigin) return null;
    if (
      (url.protocol !== "http:" && url.protocol !== "https:")
      || url.username
      || url.password
      || url.origin !== trustedOrigin
    ) {
      return null;
    }

    if (url.pathname === TERMINAL_PATHS.success) return "success";
    if (url.pathname === TERMINAL_PATHS.failed) return "failed";
    return null;
  } catch {
    return null;
  }
}

export function decideBlueNavigation(
  value: string,
  redirectOrigin: string,
  terminalAlreadyHandled: boolean,
): {
  terminalResult: BlueTerminalResult | null;
  decision: BlueNavigationDecision;
  action: BlueNavigationAction;
} {
  const terminalResult = classifyBlueTerminalUrl(value, redirectOrigin, "blue-payment-webview");
  if (terminalAlreadyHandled) {
    return { terminalResult, decision: "ignored_after_terminal", action: "ignore" };
  }
  if (terminalResult === "success") {
    return { terminalResult, decision: "terminal_success", action: "handle_terminal" };
  }
  if (terminalResult === "failed") {
    return { terminalResult, decision: "terminal_failed", action: "handle_terminal" };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { terminalResult: null, decision: "invalid_url", action: "block" };
  }

  if (url.username || url.password) {
    return { terminalResult: null, decision: "blocked_credentials", action: "block" };
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    return { terminalResult: null, decision: "allow_webview_http", action: "allow_webview" };
  }
  if (EXTERNAL_SCHEMES.has(url.protocol)) {
    return { terminalResult: null, decision: "open_external_attempt", action: "open_external" };
  }
  if (REJECTED_SCHEMES.has(url.protocol)) {
    return { terminalResult: null, decision: "blocked_dangerous_scheme", action: "block" };
  }
  return { terminalResult: null, decision: "blocked_unknown_scheme", action: "block" };
}

export function blueResultDisplayParams(value: string) {
  const allowedKeys = ["order_id", "order_number", "reference", "payment_reference"] as const;
  const result: Partial<Record<(typeof allowedKeys)[number], string>> = {};

  try {
    const url = new URL(value);
    for (const key of allowedKeys) {
      const candidate = url.searchParams.get(key)?.trim();
      if (candidate) result[key] = candidate.slice(0, 120);
    }
  } catch {
    // Terminal classification happens before this display-only extraction.
  }

  return result;
}
