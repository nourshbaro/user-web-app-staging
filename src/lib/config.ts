const trimEndSlash = (value?: string) => value?.replace(/\/$/, "");

export const config = {
  apiBaseUrl: trimEndSlash(process.env.EXPO_PUBLIC_LFA_API_BASE_URL) ?? "https://api-lfa.matrixvert.com/api",
  siteUrl: trimEndSlash(process.env.EXPO_PUBLIC_LFA_SITE_URL) ?? "https://api-lfa.matrixvert.com",
  apiPassword: process.env.EXPO_PUBLIC_LFA_API_PASSWORD ?? "",
  timeoutMs: Number(process.env.EXPO_PUBLIC_LFA_API_TIMEOUT_MS ?? 15000),
};

export function storageUrl(path?: string | null) {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  return `${config.siteUrl}/${path.replace(/^\/+/, "")}`;
}
