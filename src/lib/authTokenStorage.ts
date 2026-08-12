import { storage } from "@/lib/storage";

export const AUTH_TOKEN_KEY = "lfa_portal_token";

export const authTokenStorage = {
  get() {
    return storage.get(AUTH_TOKEN_KEY);
  },

  set(token: string) {
    return storage.set(AUTH_TOKEN_KEY, token);
  },

  remove() {
    return storage.remove(AUTH_TOKEN_KEY);
  },
};