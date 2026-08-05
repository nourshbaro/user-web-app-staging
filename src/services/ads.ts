import { apiRequest } from "@/services/api";
import type { AdsResponse, AppBannerAd } from "@/types/ads";

const APP_BANNER_PATH = "/ads?placement=app_banner";
export const APP_BANNER_REQUEST_KEY = "ads:app_banner";

export function parseAppBannerResponse(payload: unknown): AppBannerAd[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];

  return payload.data.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (typeof item.id !== "number" || !Number.isFinite(item.id) || item.id <= 0) return [];
    if (typeof item.title !== "string" || !item.title.trim()) return [];
    if (typeof item.image !== "string" || !item.image.trim()) return [];
    if (item.link_url !== null && typeof item.link_url !== "string") return [];
    if (item.placement !== "app_banner") return [];
    if (item.match_id !== null && (typeof item.match_id !== "number" || !Number.isFinite(item.match_id))) return [];
    if (typeof item.priority !== "number" || !Number.isFinite(item.priority)) return [];

    return [{
      id: item.id,
      title: item.title.trim(),
      image: item.image.trim(),
      link_url: typeof item.link_url === "string" ? item.link_url.trim() : null,
      placement: "app_banner" as const,
      match_id: item.match_id,
      priority: item.priority,
    }];
  });
}

export const adsService = {
  async appBanner(): Promise<AppBannerAd[]> {
    const payload = await apiRequest<AdsResponse>(APP_BANNER_PATH);
    return parseAppBannerResponse(payload);
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
