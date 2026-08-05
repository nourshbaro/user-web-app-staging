export type BlueTerminalResult = "success" | "failed";

const FORBIDDEN_ENCODED_PATH_SEQUENCE = /%(?:2e|2f|5c)/i;
const TERMINAL_PATHS: Record<BlueTerminalResult, string> = {
  success: "/payment/success",
  failed: "/payment/failed",
};

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

export function classifyBlueTerminalUrl(value: string, redirectOrigin: string): BlueTerminalResult | null {
  const trustedOrigin = parseConfiguredOrigin(redirectOrigin);
  if (!trustedOrigin) return null;

  try {
    const url = new URL(value);
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
