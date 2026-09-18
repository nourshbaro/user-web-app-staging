// TEMPORARY: remove after BLUE runtime diagnosis. Only log approved URL metadata.
export function blueDiagUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:", "lfa-app:"].includes(url.protocol)) return `${url.protocol}[REDACTED]`;
    const safeKeys = new Set(["provider", "order_id", "order_number", "reference", "payment_reference", "status"]);
    const path = url.pathname.split("/").map((segment, index, segments) =>
      index > 0 && segments[index - 1] === "payment" && !["success", "failed"].includes(segment)
        ? "[REDACTED]" : segment,
    ).join("/");
    const query = Array.from(url.searchParams.entries()).map(([key, candidate]) =>
      `${encodeURIComponent(key)}=${safeKeys.has(key) ? encodeURIComponent(candidate) : "[REDACTED]"}`,
    ).join("&");
    return `${url.protocol}//${url.host}${path}${query ? `?${query}` : ""}${url.hash ? "#[REDACTED]" : ""}`;
  } catch {
    return "[INVALID URL REDACTED]";
  }
}
