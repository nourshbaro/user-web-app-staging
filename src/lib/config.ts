const trimEndSlash = (value?: string) => value?.replace(/\/$/, "");

function configuredHttpOrigin(value?: string) {
  if (!value) return "";
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
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}

function originFrom(value?: string) {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return trimEndSlash(value) ?? "";
  }
}

function resolveStorageBase() {
  const explicit = trimEndSlash(process.env.EXPO_PUBLIC_LFA_STORAGE_BASE);
  if (explicit) return explicit;

  const siteUrl = trimEndSlash(process.env.EXPO_PUBLIC_LFA_SITE_URL);
  if (siteUrl) return `${siteUrl}/storage`;

  const apiOrigin = originFrom(process.env.EXPO_PUBLIC_LFA_API_BASE_URL);
  return apiOrigin ? `${apiOrigin}/storage` : "";
}

export const config = {
  apiBaseUrl: trimEndSlash(process.env.EXPO_PUBLIC_LFA_API_BASE_URL) ?? "",
  siteUrl: trimEndSlash(process.env.EXPO_PUBLIC_LFA_SITE_URL) ?? "",
  storageBaseUrl: resolveStorageBase(),
  apiPassword: process.env.EXPO_PUBLIC_LFA_API_PASSWORD ?? "",
  timeoutMs: Number(process.env.EXPO_PUBLIC_LFA_API_TIMEOUT_MS ?? 15000),
  cybersourceUnifiedCheckoutUrl:
    trimEndSlash(process.env.EXPO_PUBLIC_CYBERSOURCE_UC_SCRIPT_URL) ??
    "https://apitest.cybersource.com/uc/v1/assets/1.0.0/UnifiedCheckout.js",
  bluePaymentAllowedOrigin: configuredHttpOrigin(process.env.EXPO_PUBLIC_BLUE_PAYMENT_ALLOWED_ORIGIN),
  blueRedirectOrigin: configuredHttpOrigin(process.env.EXPO_PUBLIC_BLUE_REDIRECT_ORIGIN),
};

export function storageUrl(path?: string | null) {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  const normalized = path.replace(/^\/+/, "").replace(/^storage\//, "");
  return config.storageBaseUrl ? `${config.storageBaseUrl}/${normalized}` : normalized;
}
