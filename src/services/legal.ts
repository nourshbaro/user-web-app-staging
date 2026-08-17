import { apiRequest, unwrapData } from "@/services/api";

type LegalDocumentPayload = string | Record<string, unknown>;

const CONTENT_KEYS = ["content", "body", "text", "privacy_policy", "privacyPolicy"] as const;

export const legalService = {
  async privacyPolicy() {
    const payload = unwrapData(await apiRequest<LegalDocumentPayload | { data: LegalDocumentPayload }>("/legal/privacy-policy"));
    return readLegalContent(payload);
  },
};

function readLegalContent(payload: LegalDocumentPayload): string {
  if (typeof payload === "string") return normalizeLegalText(payload);

  for (const key of CONTENT_KEYS) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return normalizeLegalText(value);
  }

  throw new Error("The privacy policy is currently unavailable.");
}

function normalizeLegalText(value: string) {
  return value
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|section)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
