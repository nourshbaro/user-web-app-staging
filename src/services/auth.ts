import { apiRequest, clearToken, setToken, unwrapData } from "@/services/api";
import { storage } from "@/lib/storage";
import type { User } from "@/types";

const USER_KEY = "lfa_portal_user";

function readToken(payload: any): string | null {
  return payload?.token ?? payload?.access_token ?? payload?.data?.token ?? payload?.data?.access_token ?? null;
}

function readUser(payload: any): User | null {
  return payload?.user ?? payload?.data?.user ?? payload?.customer ?? null;
}

export const authService = {
  async currentUser() {
    const value = await storage.get(USER_KEY);
    return value ? JSON.parse(value) as User : null;
  },

  async saveSession(payload: unknown) {
    const token = readToken(payload);
    const user = readUser(payload);
    if (token) await setToken(token);
    if (user) await storage.set(USER_KEY, JSON.stringify(user));
    return { token, user };
  },

  async login(email: string, password: string) {
    const payload = await apiRequest("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    await this.saveSession(payload);
    return payload;
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
    });
    await this.saveSession(payload);
    return payload;
  },

  async verifyOtp(userId: string, code: string) {
    const payload = await apiRequest("/auth/verify-otp", { method: "POST", body: JSON.stringify({ user_id: userId, code }) });
    await this.saveSession(payload);
    return payload;
  },

  async resendOtp(userId: string) {
    return apiRequest("/auth/resend-otp", { method: "POST", body: JSON.stringify({ user_id: userId }) });
  },

  async logout() {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } catch {}
    await clearToken();
    await storage.remove(USER_KEY);
  },
};

export const profileService = {
  async billingInfo() {
    return unwrapData(await apiRequest("/portal/billing-info"));
  },
  async orders() {
    return unwrapData(await apiRequest("/portal/orders")) as any[];
  },
  async order(orderId: string | number) {
    return unwrapData(await apiRequest(`/portal/orders/${encodeURIComponent(String(orderId))}`)) as Record<string, unknown>;
  },
  async tickets() {
    return unwrapData(await apiRequest("/portal/tickets")) as any[];
  },
  async ticket(ticketCode: string | number) {
    return unwrapData(await apiRequest(`/portal/tickets/${encodeURIComponent(String(ticketCode))}`)) as Record<string, unknown>;
  },
};
