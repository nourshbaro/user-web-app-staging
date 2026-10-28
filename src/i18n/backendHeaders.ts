import { getAppLocale } from "./locales.ts";

/** Only for LFA requests. Accepts every Fetch HeadersInit shape. */
export function backendHeaders(defaults: Record<string, string>, overrides?: HeadersInit) {
  const result = { ...defaults };
  new Headers(overrides).forEach((value, key) => {
    const existing = Object.keys(result).find((name) => name.toLowerCase() === key);
    const canonical = ["Authorization", "Accept", "Content-Type", "password"].find((name) => name.toLowerCase() === key);
    result[existing ?? canonical ?? key] = value;
  });
  for (const key of Object.keys(result)) {
    if (key.toLowerCase() === "accept-language") delete result[key];
  }
  result["Accept-Language"] = getAppLocale();
  return result;
}
