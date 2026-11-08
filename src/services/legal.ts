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

/**
 * Returns the document as published (HTML fragment or plain text). Structure
 * is read for display by `parseLegalDocument`, never rendered as HTML.
 */
function readLegalContent(payload: LegalDocumentPayload, unavailableMessage: string): string {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (typeof payload === "string") throw new Error(unavailableMessage);

  for (const key of CONTENT_KEYS) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  throw new Error(unavailableMessage);
}
