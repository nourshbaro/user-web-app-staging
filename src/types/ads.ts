export type AppBannerAd = {
  id: number;
  title: string;
  image: string;
  link_url: string | null;
  placement: "app_banner";
  match_id: number | null;
  priority: number;
};

export type AdsResponse = {
  data: AppBannerAd[];
};
