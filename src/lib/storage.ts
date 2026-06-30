type Store = Record<string, string>;

const memoryStore: Store = {};

const webStorage = () => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
};

export const storage = {
  async get(key: string) {
    const local = webStorage();
    return local ? local.getItem(key) : memoryStore[key] ?? null;
  },
  async set(key: string, value: string) {
    const local = webStorage();
    if (local) local.setItem(key, value);
    else memoryStore[key] = value;
  },
  async remove(key: string) {
    const local = webStorage();
    if (local) local.removeItem(key);
    else delete memoryStore[key];
  },
};
