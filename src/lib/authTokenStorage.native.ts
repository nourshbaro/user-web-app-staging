import * as SecureStore from "expo-secure-store";
import { storage as legacyStorage } from "@/lib/storage";
import {
  createNativeAuthTokenStorage,
  type AuthTokenKeyValueStorage,
} from "@/lib/authTokenStorageCore";

const secureStorage: AuthTokenKeyValueStorage = {
  get(key) {
    return SecureStore.getItemAsync(key);
  },

  set(key, value) {
    return SecureStore.setItemAsync(key, value);
  },

  remove(key) {
    return SecureStore.deleteItemAsync(key);
  },
};

export const authTokenStorage = createNativeAuthTokenStorage(
  secureStorage,
  legacyStorage,
);