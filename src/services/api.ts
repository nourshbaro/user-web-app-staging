import { config } from "@/lib/config";
import { storage } from "@/lib/storage";
import { Platform } from "react-native";

const TOKEN_KEY = "lfa_portal_token";

export class ApiError extends Error {
  status: number;
  body: any;

  constructor(message: string, status: number, body: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function getToken() {
  return storage.get(TOKEN_KEY);
}

export async function setToken(token: string) {
  await storage.set(TOKEN_KEY, token);
}

export async function clearToken() {
  await storage.remove(TOKEN_KEY);
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(config.timeoutMs) ? config.timeoutMs : 15000);
  const url = Platform.OS === "web" ? `/api${path}` : `${config.apiBaseUrl}${path}`;

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(Platform.OS !== "web" && config.apiPassword ? { password: config.apiPassword } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) await clearToken();
      const message = body?.message ?? body?.error ?? `Request failed with ${response.status}`;
      throw new ApiError(message, response.status, body);
    }

    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function unwrapData<T>(payload: T | { data: T }): T {
  return payload && typeof payload === "object" && "data" in payload ? (payload as { data: T }).data : payload as T;
}
