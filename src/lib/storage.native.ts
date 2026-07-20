import AsyncStorage from "@react-native-async-storage/async-storage";

export const storage = {
  get(key: string) {
    return AsyncStorage.getItem(key);
  },
  set(key: string, value: string) {
    return AsyncStorage.setItem(key, value);
  },
  remove(key: string) {
    return AsyncStorage.removeItem(key);
  },
};
