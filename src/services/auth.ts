import { config } from "@/lib/config";
import { normalizePaginatedProfileResult } from "@/lib/profilePortal";
import { storage } from "@/lib/storage";
import { backendResponseMessage } from "@/lib/userFacingError";
import {
  ApiError,
  ApiTransportError,
  activateMaintenance,
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
import type {
  Order,
  PortalMatch,
  PortalMatchTeam,
  PortalTicket,
  PortalTicketsResponse,
  RegisterRequest,
  User,
} from "@/types";
import { File } from "expo-file-system";
import { Platform } from "react-native";

const USER_KEY = "lfa_portal_user";
export type OtpTarget =
  | string
  | { userId?: string | null; email?: string | null };
/** Sign-in identifier: the backend takes `email` or `phone` (digits only), never both. */
export type LoginIdentifier = { email: string } | { phone: string };
/** Recovery identifier, same shape as sign-in. */
export type RecoveryIdentifier = LoginIdentifier;
export type LoginResult =
  | { status: "authenticated"; payload: unknown }
  | { status: "phone_required"; message: string };

export class PdfDownloadHttpError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPortalMatchTeam(value: unknown): value is PortalMatchTeam {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    Number.isInteger(value.id) &&
    typeof value.name === "string" &&
    (value.logo === null || typeof value.logo === "string")
  );
}

function isPortalMatch(value: unknown): value is PortalMatch {
  return (
    isRecord(value) &&
    typeof value.match_id === "number" &&
    Number.isInteger(value.match_id) &&
    value.match_id > 0 &&
    typeof value.kickoff_at === "string" &&
    typeof value.is_upcoming === "boolean" &&
    typeof value.status === "string" &&
    isPortalMatchTeam(value.home_team) &&
    isPortalMatchTeam(value.away_team) &&
    (value.stadium === null || typeof value.stadium === "string") &&
    typeof value.ticket_count === "number" &&
    Number.isInteger(value.ticket_count) &&
    value.ticket_count >= 0
  );
}

function isPortalTicket(value: unknown): value is PortalTicket {
  if (!isRecord(value) || !isRecord(value.match) || !isRecord(value.zone))
    return false;
  const match = value.match;
  const zone = value.zone;
  return (
    typeof value.ticket_code === "string" &&
    typeof value.holder_name === "string" &&
    typeof value.status === "string" &&
    typeof value.order_code === "string" &&
    typeof match.id === "number" &&
    Number.isInteger(match.id) &&
    typeof match.kickoff_at === "string" &&
    typeof match.home_team === "string" &&
    (match.home_team_logo === null ||
      typeof match.home_team_logo === "string") &&
    typeof match.away_team === "string" &&
    (match.away_team_logo === null ||
      typeof match.away_team_logo === "string") &&
    typeof zone.id === "number" &&
    Number.isInteger(zone.id) &&
    typeof zone.name === "string" &&
    (value.seat === null || isRecord(value.seat)) &&
    (value.checked_in_at === null || typeof value.checked_in_at === "string") &&
    typeof value.created_at === "string" &&
    // The list may omit the QR (absent / null); the detail endpoint completes it.
    (value.qr_image === undefined || value.qr_image === null || typeof value.qr_image === "string")
  );
}

function isUser(value: unknown): value is User {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    Number.isFinite(value.id) &&
    typeof value.name === "string" &&
    // Phone-only accounts (email optional at registration) have `email: null`.
    (value.email === null || typeof value.email === "string") &&
    (value.phone === null || typeof value.phone === "string") &&
    (value.avatar === null || typeof value.avatar === "string") &&
    (value.email_verified_at === null ||
      typeof value.email_verified_at === "string") &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string" &&
    (value.deleted_at === null || typeof value.deleted_at === "string")
  );
}

function hasValidOptionalUserFields(value: Record<string, unknown>) {
  if (
    "id" in value &&
    (typeof value.id !== "number" || !Number.isFinite(value.id))
  ) {
    return false;
  }

  if ("name" in value && typeof value.name !== "string") {
    return false;
  }

  if ("email" in value && value.email !== null && typeof value.email !== "string") {
    return false;
  }

  if (
    "email_verified_at" in value &&
    value.email_verified_at !== null &&
    typeof value.email_verified_at !== "string"
  ) {
    return false;
  }

  return true;
}

function decodePersistedUser(
  value: string | null,
): PersistedAuthenticationValue<User> {
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

  const hasId =
    typeof candidate.id === "number" && Number.isFinite(candidate.id);
  const hasEmail =
    typeof candidate.email === "string" && candidate.email.trim().length > 0;

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
  return (
    payload?.token ??
    payload?.access_token ??
    payload?.data?.token ??
    payload?.data?.access_token ??
    null
  );
}

function readUser(payload: any): User | null {
  return payload?.user ?? payload?.data?.user ?? payload?.customer ?? null;
}

function phoneRequiredResult(payload: unknown): LoginResult | null {
  const data = unwrapData(payload);
  if (!isRecord(data) || data.reason !== "phone_required") return null;
  return {
    status: "phone_required",
    message:
      typeof data.message === "string" && data.message.trim()
        ? data.message.trim()
        : "Please add your phone number to continue.",
  };
}

function identifierBody(identifier: LoginIdentifier) {
  return "phone" in identifier ? { phone: identifier.phone } : { email: identifier.email };
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
    return restoreAuthentication(readPersistedUser, () =>
      storage.remove(USER_KEY),
    );
  },

  async saveSession(payload: unknown) {
    const token = readToken(payload);
    const user = readUser(payload);
    if (token) await setToken(token);
    if (user) await storage.set(USER_KEY, JSON.stringify(user));
    return { token, user };
  },

  async login(
    identifier: LoginIdentifier,
    password: string,
    remember: boolean,
  ): Promise<LoginResult> {
    let payload: unknown;
    try {
      payload = await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ ...identifierBody(identifier), password, remember }),
        skipUnauthenticatedNotify: true,
      });
    } catch (error) {
      const phoneRequired =
        error instanceof ApiError ? phoneRequiredResult(error.body) : null;
      if (phoneRequired) return phoneRequired;
      throw error;
    }
    const phoneRequired = phoneRequiredResult(payload);
    if (phoneRequired) return phoneRequired;
    await this.saveSession(payload);
    return { status: "authenticated", payload };
  },

  async completePhone(email: string, password: string, phone: string) {
    const payload = await apiRequest("/auth/complete-phone", {
      method: "POST",
      body: JSON.stringify({ email, password, phone }),
      skipUnauthenticatedNotify: true,
    });
    await this.saveSession(payload);
    return payload;
  },

  /**
   * Starts recovery for an email or a phone. The answer is read with
   * `forgotPasswordOutcome` (`src/lib/passwordRecovery.ts`): its only branch
   * signal is `reason: "email_required"` (a phone account with no email).
   */
  async forgotPassword(identifier: RecoveryIdentifier) {
    return apiRequest<unknown>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify(identifierBody(identifier)),
      skipUnauthenticatedNotify: true,
    });
  },

  /** Saves an email on a phone account that has none and sends the reset code to it. */
  async addRecoveryEmail(phone: string, email: string) {
    return apiRequest("/auth/forgot-password/add-email", {
      method: "POST",
      body: JSON.stringify({ email, phone }),
      skipUnauthenticatedNotify: true,
    });
  },

  /**
   * Verify and reset are keyed by the attempt's recovery identity
   * (`recoveryTarget`), one field, like `forgotPassword`. Staging accepts
   * only `email` today; a phone-keyed attempt gets its 422 back unchanged.
   */
  async verifyForgotPasswordOtp(target: RecoveryIdentifier, code: string) {
    return apiRequest("/auth/forgot-password/verify-otp", {
      method: "POST",
      body: JSON.stringify({ ...identifierBody(target), code }),
      skipUnauthenticatedNotify: true,
    });
  },

  async resetPassword(
    target: RecoveryIdentifier,
    code: string,
    password: string,
    passwordConfirmation: string,
  ) {
    return apiRequest("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({
        ...identifierBody(target),
        code,
        password,
        "password_confirmation": passwordConfirmation,
      }),
      skipUnauthenticatedNotify: true,
    });
  },

  async checkEmailVerification(email: string) {
    const endpoints = [
      "/auth/check-email-verification",
      "/auth/check-email",
      "/auth/email-verification-status",
    ];
    for (const endpoint of endpoints) {
      try {
        return await apiRequest(endpoint, {
          method: "POST",
          body: JSON.stringify({ email }),
          skipUnauthenticatedNotify: true,
        });
      } catch (err) {
        if (
          err instanceof ApiError &&
          (err.status === 404 || err.status === 405)
        )
          continue;
        throw err;
      }
    }
    return null;
  },

  async register(
    name: string,
    email: string | null,
    password: string,
    passwordConfirmation: string,
    phone: string,
  ) {
    // Email is optional (the backend requires only name, phone and
    // password); none given → the field is omitted, never sent blank.
    const body: RegisterRequest = {
      name,
      ...(email ? { email } : {}),
      password,
      password_confirmation: passwordConfirmation,
      phone,
    };
    const payload = await apiRequest("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
      skipUnauthenticatedNotify: true,
    });
    await this.saveSession(payload);
    return payload;
  },

  async me() {
    const payload = await apiRequest<unknown>("/auth/me");
    const data = unwrapData(payload);
    if (!isUser(data)) {
      throw new Error("Invalid /auth/me response");
    }
    return data;
  },

  async verifyOtp(target: OtpTarget, code: string) {
    const payload = await apiRequest("/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify({ ...otpTargetBody(target), code }),
      skipUnauthenticatedNotify: true,
    });
    await this.saveSession(payload);
    return payload;
  },

  async resendOtp(target: OtpTarget) {
    return apiRequest("/auth/resend-otp", {
      method: "POST",
      body: JSON.stringify(otpTargetBody(target)),
      skipUnauthenticatedNotify: true,
    });
  },

  async logout() {
    const logoutOwnership = await beginAuthenticationLogout(() =>
      storage.remove(USER_KEY),
    );
    void apiRequest("/auth/logout", {
      method: "POST",
      skipUnauthenticatedNotify: true,
      headers: logoutOwnership.token
        ? { Authorization: `Bearer ${logoutOwnership.token}` }
        : undefined,
    }).catch(() => {});
  },

  async deleteAccount(password: string) {
    const payload = await apiRequest("/auth/account", {
      method: "DELETE",
      body: JSON.stringify({ password }),
    });
    await clearAuthentication(() => storage.remove(USER_KEY));
    return payload;
  },

  async changePassword(
    currentPassword: string,
    password: string,
    passwordConfirmation: string,
  ) {
    const path = "/auth/change-password";
    const fields = ["current_password", "password", "password_confirmation"];
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      // console.log("Change password request", {
      //   path,
      //   fields,
      //   authenticated: Boolean(await getToken()),
      // });
    }
    let payload: unknown;
    try {
      payload = await apiRequest<unknown>(path, {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          password,
          password_confirmation: passwordConfirmation,
        }),
      });
    } catch (error) {
      if (
        typeof __DEV__ !== "undefined" &&
        __DEV__ &&
        error instanceof ApiError
      ) {
        console.log("Change password response", {
          path,
          status: error.status,
          body: error.body,
        });
      }
      throw error;
    }
    const message = isRecord(payload) ? payload.message : null;
    return typeof message === "string" && message.trim()
      ? message
      : "Password changed. Please log in again.";
  },

  async uploadProfilePicture(file: {
    uri: string;
    name: string;
    type: string;
  }): Promise<{ avatar: string }> {
    const avatarFile = new File(file.uri);

    const formData = new FormData();

    formData.append("avatar", avatarFile as unknown as Blob, file.name);

    return apiRequest<{ avatar: string }>("/auth/profile-picture", {
      method: "POST",
      body: formData,
    });
  },

  async removeProfilePicture() {
    return apiRequest("/auth/profile-picture", {
      method: "DELETE",
    });
  },

  async clearSession() {
    await clearAuthentication(() => storage.remove(USER_KEY));
  },

  async persistUser(user: User) {
    await storage.set(USER_KEY, JSON.stringify(user));
  },
};

export async function registerAnonymousDevice(
  fcmToken: string,
  platform: "android" | "ios",
) {
  return apiRequest("/devices", {
    method: "POST",
    body: JSON.stringify({
      token: fcmToken,
      platform,
    }),
    overrideAuthorizationToken: null,
    skipUnauthenticatedNotify: true,
  });
}

export async function registerAuthenticatedDevice(
  fcmToken: string,
  platform: "android" | "ios",
) {
  // No overrideAuthorizationToken here: apiRequest resolves the live
  // session immediately before it builds headers, so this always sends
  // whichever bearer token (if any) is current at fetch time rather than
  // one pinned earlier in the call chain.
  return apiRequest("/devices", {
    method: "POST",
    body: JSON.stringify({
      token: fcmToken,
      platform,
    }),
  });
}

export const profileService = {
  async matches(filter: "all" | "upcoming" | "past") {
    const payload = await apiRequest<unknown>(
      `/portal/matches?filter=${filter}`,
    );
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      throw new Error("Invalid portal matches collection");
    }
    const result = normalizePaginatedProfileResult<unknown>(payload);
    if (!result.items.every(isPortalMatch))
      throw new Error("Invalid portal match response");
    return { items: result.items as PortalMatch[], total: result.total };
  },
  async orders() {
    return normalizePaginatedProfileResult<Order>(
      await apiRequest("/portal/orders"),
    );
  },
  async order(orderId: string | number) {
    return unwrapData(
      await apiRequest(`/portal/orders/${encodeURIComponent(String(orderId))}`),
    ) as Record<string, unknown>;
  },
  async tickets(matchId: string | number) {
    const payload = await apiRequest<PortalTicketsResponse>(
      `/portal/tickets?match_id=${encodeURIComponent(String(matchId))}`,
    );
    if (
      !isRecord(payload) ||
      !Array.isArray(payload.data) ||
      !isRecord(payload.meta)
    ) {
      throw new Error("Invalid portal tickets collection");
    }
    const result = normalizePaginatedProfileResult<unknown>(payload);
    if (!result.items.every(isPortalTicket))
      throw new Error("Invalid portal ticket response");
    return { items: result.items as PortalTicket[], total: result.total };
  },
  async ticket(ticketCode: string | number) {
    return unwrapData(
      await apiRequest(
        `/portal/tickets/${encodeURIComponent(String(ticketCode))}`,
      ),
    ) as Record<string, unknown>;
  },
  async orderPdf(orderId: string | number) {
    const authentication = await captureAuthenticationSnapshot();
    const token = authentication.token;
    const encodedId = encodeURIComponent(String(orderId));
    const url =
      Platform.OS === "web"
        ? `/api/portal/orders/${encodedId}/pdf`
        : `${config.apiBaseUrl}/portal/orders/${encodedId}/pdf`;
    const controller = new AbortController();
    let didTimeout = false;
    const timeout = setTimeout(
      () => {
        didTimeout = true;
        controller.abort();
      },
      Number.isFinite(config.timeoutMs) ? config.timeoutMs : 15000,
    );

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/pdf,application/octet-stream,*/*",
          ...(Platform.OS !== "web" && config.apiPassword
            ? { password: config.apiPassword }
            : {}),
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

        if (response.status === 503) activateMaintenance();

        if (response.status === 401 || response.status === 403) {
          await invalidateAuthentication(authentication);
        }

        throw new PdfDownloadHttpError(
          backendResponseMessage(body) ?? "Failed to download PDF.",
        );
      }

      return new Uint8Array(await response.arrayBuffer());
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
