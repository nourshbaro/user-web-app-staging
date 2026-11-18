import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createUnresolvedCardResultStore } from "@/lib/unresolvedCardResultStore";

/**
 * Native: markers in SecureStore (chunked under the iOS value-size ceiling);
 * the ledger, which takes what SecureStore could not, in AsyncStorage.
 * Markers hold no payment JWT, billing details or holder names.
 */
export const unresolvedCardResultStorage = createUnresolvedCardResultStore({
  primary: {
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value),
    remove: (key) => SecureStore.deleteItemAsync(key),
  },
  ledger: {
    get: (key) => AsyncStorage.getItem(key),
    set: (key, value) => AsyncStorage.setItem(key, value),
    remove: (key) => AsyncStorage.removeItem(key),
  },
});
