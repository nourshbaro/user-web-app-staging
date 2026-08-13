import { Platform } from "react-native";
import { config } from "@/lib/config";
import { normalizePaginatedProfileResult } from "@/lib/profilePortal";
import {
  ApiError,
  ApiTransportError,
  apiRequest,
  beginAuthenticationLogout,
  captureAuthenticationSnapshot,
  clearAuthentication,
  invalidateAuthentication,
  restoreAuthentication,
  setToken,
  unwrapData,
  type PersistedAuthenticationValue,
} from "@/services/api";
import { storage } from "@/lib/storage";
import type { Order, User } from "@/types";

const USER_KEY = "lfa_portal_user";
export type OtpTarget = string | { userId?: string | null; email?: string | null };

class PdfDownloadHttpError extends Error { }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidOptionalUserFields(value: Record<string, unknown>) {
  if (
    "id" in value
    && (typeof value.id !== "number" || !Number.isFinite(value.id))
  ) {
    return false;
  }

  if ("name" in value && typeof value.name !== "string") {
    return false;
  }

  if ("email" in value && typeof value.email !== "string") {
    return false;
  }

  if (
    "email_verified_at" in value
    && value.email_verified_at !== null
    && typeof value.email_verified_at !== "string"
  ) {
    return false;
  }

  return true;
}

function decodePersistedUser(value: string | null): PersistedAuthenticationValue<User> {
  if (value === null) return { status: "missing" };

  let candidate: unknown;

  try {
    candidate = JSON.parse(value);
  } catch {
    return { status: "invalid" };
  }

  if (!isRecord(candidate) || !hasValidOptionalUserFields(candidate)) {
    return { status: "invalid" };
  }

  const hasId = typeof candidate.id === "number" && Number.isFinite(candidate.id);
  const hasEmail = typeof candidate.email === "string" && candidate.email.trim().length > 0;

  if (!hasId && !hasEmail) {
    return { status: "invalid" };
  }

  return {
    status: "valid",
    value: candidate as User,
  };
}

async function readPersistedUser() {
  return decodePersistedUser(await storage.get(USER_KEY));
}

function readToken(payload: any): string | null {
  return payload?.token ?? payload?.access_token ?? payload?.data?.token ?? payload?.data?.access_token ?? null;
}

function readUser(payload: any): User | null {
  return payload?.user ?? payload?.data?.user ?? payload?.customer ?? null;
}

function otpTargetBody(target: OtpTarget) {
  if (typeof target === "string") return { user_id: target };
  return {
    ...(target.userId ? { user_id: target.userId } : {}),
    ...(target.email ? { email: target.email } : {}),
  };
}

export const authService = {
  async currentUser() {
    const persistedUser = await readPersistedUser();

    if (persistedUser.status === "invalid") {
      throw new Error("Persisted user data is invalid.");
    }

    return persistedUser.status === "valid" ? persistedUser.value : null;
  },

  async restoreSession() {
    return restoreAuthentication(
      readPersistedUser,
      () => storage.remove(USER_KEY),
    );
  },

  async saveSession(payload: unknown) {
    const token = readToken(payload);
    const user = readUser(payload);
    if (token) await setToken(token);
    if (user) await storage.set(USER_KEY, JSON.stringify(user));
    return { token, user };
  },

  async login(email: string, password: string) {
    const payload = await apiRequest("/auth/login", { method: "POST", body: JSON.stringify({ email, password }), skipUnauthenticatedNotify: true });
    await this.saveSession(payload);
    return payload;
  },

  async checkEmailVerification(email: string) {
    const endpoints = ["/auth/check-email-verification", "/auth/check-email", "/auth/email-verification-status"];
    for (const endpoint of endpoints) {
      try {
        return await apiRequest(endpoint, { method: "POST", body: JSON.stringify({ email }), skipUnauthenticatedNotify: true });
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 405)) continue;
        throw err;
      }
    }
    return null;
  },

  async register(name: string, email: string, password: string, passwordConfirmation: string) {
    const payload = await apiRequest("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name,
        email,
        password,
        password_confirmation: passwordConfirmation,
      }),
      skipUnauthenticatedNotify: true,
    });
    await this.saveSession(payload);
    return payload;
  },

  async verifyOtp(target: OtpTarget, code: string) {
    const payload = await apiRequest("/auth/verify-otp", { method: "POST", body: JSON.stringify({ ...otpTargetBody(target), code }), skipUnauthenticatedNotify: true });
    await this.saveSession(payload);
    return payload;
  },

  async resendOtp(target: OtpTarget) {
    return apiRequest("/auth/resend-otp", { method: "POST", body: JSON.stringify(otpTargetBody(target)), skipUnauthenticatedNotify: true });
  },

  async logout() {
    const logoutOwnership = await beginAuthenticationLogout(() => storage.remove(USER_KEY));
    void apiRequest("/auth/logout", {
      method: "POST",
      skipUnauthenticatedNotify: true,
      headers: logoutOwnership.token ? { Authorization: `Bearer ${logoutOwnership.token}` } : undefined,
    })
      .catch(() => { });
  },

  async clearSession() {
    await clearAuthentication(() => storage.remove(USER_KEY));
  },
};

export const profileService = {
  async billingInfo() {
    return unwrapData(await apiRequest("/portal/billing-info"));
  },
  async orders() {
    return normalizePaginatedProfileResult<Order>(
      await apiRequest("/portal/orders"),
    );
  },
  async order(orderId: string | number) {
    return unwrapData(await apiRequest(`/portal/orders/${encodeURIComponent(String(orderId))}`)) as Record<string, unknown>;
  },
  async tickets() {
    return normalizePaginatedProfileResult<Record<string, unknown>>(
      await apiRequest("/portal/tickets"),
    );
  },
  async ticket(ticketCode: string | number) {
    return unwrapData(await apiRequest(`/portal/tickets/${encodeURIComponent(String(ticketCode))}`)) as Record<string, unknown>;
  },
  async orderPdf(orderId: string | number) {
    const authentication = await captureAuthenticationSnapshot();
    const token = authentication.token;
    const encodedId = encodeURIComponent(String(orderId));
    const url = Platform.OS === "web"
      ? `/api/portal/orders/${encodedId}/pdf`
      : `${config.apiBaseUrl}/portal/orders/${encodedId}/pdf`;
    const controller = new AbortController();
    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, Number.isFinite(config.timeoutMs) ? config.timeoutMs : 15000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/pdf,application/octet-stream,*/*",
          ...(Platform.OS !== "web" && config.apiPassword ? { password: config.apiPassword } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!response.ok) {
        let body: { message?: string; error?: string } | null = null;

        try {
          body = await response.json();
        } catch (error) {
          if (didTimeout) throw error;
        }

        if (response.status === 401 || response.status === 403) {
          await invalidateAuthentication(authentication);
        }

        throw new PdfDownloadHttpError(
          body?.message ?? body?.error ?? "Failed to download PDF.",
        );
      }

      return await response.arrayBuffer();
    } catch (error) {
      if (error instanceof PdfDownloadHttpError) throw error;

      if (didTimeout) {
        throw new ApiTransportError(
          "The request timed out. Please try again.",
          "timeout",
          error,
        );
      }

      throw new ApiTransportError(
        "Unable to reach the server. Check your connection and try again.",
        "network",
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
  },
};
