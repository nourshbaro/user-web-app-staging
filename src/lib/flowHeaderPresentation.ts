/**
 * Platform presentation of the pushed-screen header (LFA Screen v3 `P` tokens).
 * Pure module, so the platform split is unit-tested rather than inferred from
 * screenshots.
 *
 * v3 draws the same header two ways:
 * - iOS: the back chevron in brand red with the previous screen's name beside
 *   it, and (on screens that have one) a centred 17/600 mixed-case title.
 * - Android: an ink back arrow with no label, and the title start-aligned
 *   beside it in Barlow Condensed 700 26 uppercase — or, for a title with a
 *   detail line (v3 `seats`), a plain 20/400 title over the detail.
 *
 * Some v3 screens show no header title on iOS (their large in-page heading is
 * the title: `holders`, `checkout`, `ticket`) while Android still shows it;
 * `titleOnIos: false` selects that. Web follows the iOS presentation.
 */

export type HeaderPlatform = "ios" | "android";

export function headerPlatform(os: string): HeaderPlatform {
  return os === "android" ? "android" : "ios";
}

export type FlowHeaderOptions = {
  title: string;
  subtitle?: string;
  backLabel?: string;
  /** false: v3 shows no header title on iOS for this screen (Android still does). */
  titleOnIos?: boolean;
  /** Android title style: v3 display title (default) or the plain 20pt title with a detail line (`seats`). */
  androidTitle?: "display" | "plain";
};

export type FlowHeaderLayout = {
  backGlyph: "chevron" | "arrow";
  backTone: "brand" | "strong";
  /** The previous screen's name beside the glyph (iOS only). */
  backLabel: string | null;
  title: null | {
    text: string;
    placement: "center" | "start";
    style: "plain" | "display" | "plainLarge";
  };
  subtitle: string | null;
};

export function flowHeaderLayout(platform: HeaderPlatform, options: FlowHeaderOptions): FlowHeaderLayout {
  const title = options.title.trim();
  const subtitle = options.subtitle?.trim() || null;
  if (platform === "ios") {
    const showTitle = Boolean(title) && options.titleOnIos !== false;
    return {
      backGlyph: "chevron",
      backTone: "brand",
      backLabel: options.backLabel?.trim() || null,
      title: showTitle ? { text: title, placement: "center", style: "plain" } : null,
      subtitle: showTitle ? subtitle : null,
    };
  }
  return {
    backGlyph: "arrow",
    backTone: "strong",
    backLabel: null,
    title: title
      ? { text: title, placement: "start", style: options.androidTitle === "plain" ? "plainLarge" : "display" }
      : null,
    subtitle: title ? subtitle : null,
  };
}
