import { storageUrl } from "@/lib/config";

const STATIC_INTERNAL_ROUTES = new Set([
  "/",
  "/cart",
  "/competitions",
  "/matches",
  "/profile",
  // Legacy: still accepted for existing ad links; the route redirects to /competitions.
  "/tournament",
]);

export type SafeAdLink =
  | { kind: "internal"; href: string }
  | { kind: "external"; href: string };

export function resolveAdImageUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || hasTraversalSegment(candidate)) return null;

  const resolved = storageUrl(candidate);
  if (!resolved) return null;

  try {
    const url = new URL(resolved);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function classifyAdLink(value: string | null): SafeAdLink | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  if (candidate.startsWith("/")) {
    if (candidate.startsWith("//") || candidate.includes("\\") || hasTraversalSegment(candidate)) {
      return null;
    }

    try {
      const parsed = new URL(candidate, "https://native.invalid");
      if (parsed.origin !== "https://native.invalid" || parsed.username || parsed.password || parsed.hash) {
        return null;
      }
      if (!isAllowedInternalPath(parsed.pathname)) return null;
      return { kind: "internal", href: `${parsed.pathname}${parsed.search}` };
    } catch {
      return null;
    }
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return { kind: "external", href: parsed.href };
  } catch {
    return null;
  }
}

function isAllowedInternalPath(pathname: string) {
  return STATIC_INTERNAL_ROUTES.has(pathname) || /^\/match\/[1-9]\d*$/.test(pathname);
}

function hasTraversalSegment(value: string) {
  try {
    return decodeURIComponent(value)
      .replace(/\\/g, "/")
      .split(/[/?#]/)
      .some((segment) => segment === "." || segment === "..");
  } catch {
    return true;
  }
}
