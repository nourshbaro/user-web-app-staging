import { apiRequest, unwrapData } from "@/services/api";

type LegalDocumentPayload = string | Record<string, unknown>;

const CONTENT_KEYS = [
  "content", "body", "text",
  "privacy_policy", "privacyPolicy",
  "terms_of_use", "termsOfUse", "terms",
] as const;

export const legalService = {
  async privacyPolicy() {
    return fetchLegalDocument("/legal/privacy-policy", "The privacy policy is currently unavailable.");
  },
  async termsOfUse() {
    return fetchLegalDocument("/legal/terms-of-use", "The terms of use are currently unavailable.");
  },
};

async function fetchLegalDocument(path: string, unavailableMessage: string) {
  const payload = unwrapData(await apiRequest<LegalDocumentPayload | { data: LegalDocumentPayload }>(path));
  return readLegalContent(payload, unavailableMessage);
}

function readLegalContent(payload: LegalDocumentPayload, unavailableMessage: string): string {
  if (typeof payload === "string") return normalizeLegalText(payload);

  for (const key of CONTENT_KEYS) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return normalizeLegalText(value);
  }

  throw new Error(unavailableMessage);
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
