import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
    AUTH_TOKEN_KEY,
    AUTH_TOKEN_STORAGE_OWNER_KEY,
    createNativeAuthTokenStorage,
} from "./authTokenStorageCore.ts";

function createStore(initial = {}) {
    const values = new Map(Object.entries(initial));
    const calls = [];
    const failures = {
        get: new Set(),
        set: new Set(),
        remove: new Set(),
    };

    return {
        values,
        calls,
        failures,

        async get(key) {
            calls.push(["get", key]);
            if (failures.get.has(key)) {
                throw new Error(`get failed: ${key}`);
            }
            return values.get(key) ?? null;
        },

        async set(key, value) {
            calls.push(["set", key, value]);
            if (failures.set.has(key)) {
                throw new Error(`set failed: ${key}`);
            }
            values.set(key, value);
        },

        async remove(key) {
            calls.push(["remove", key]);
            if (failures.remove.has(key)) {
                throw new Error(`remove failed: ${key}`);
            }
            values.delete(key);
        },
    };
}

test("fresh native login writes only secure token storage", async () => {
    const secure = createStore();
    const legacy = createStore();
    const tokenStorage = createNativeAuthTokenStorage(secure, legacy);

    await tokenStorage.set("token-b");

    assert.equal(secure.values.get(AUTH_TOKEN_KEY), "token-b");
    assert.equal(
        secure.values.get(AUTH_TOKEN_STORAGE_OWNER_KEY),
        "secure",
    );
    assert.equal(legacy.values.has(AUTH_TOKEN_KEY), false);
});

test("secure restoration returns the secure token", async () => {
    const secure = createStore({
        [AUTH_TOKEN_KEY]: "token-a",
        [AUTH_TOKEN_STORAGE_OWNER_KEY]: "secure",
    });
    const legacy = createStore();
    const tokenStorage = createNativeAuthTokenStorage(secure, legacy);

    assert.equal(await tokenStorage.get(), "token-a");
});

test("legacy token migrates securely before legacy deletion", async () => {
    const secure = createStore();
    const legacy = createStore({
        [AUTH_TOKEN_KEY]: "token-a",
    });
    const tokenStorage = createNativeAuthTokenStorage(secure, legacy);

    assert.equal(await tokenStorage.get(), "token-a");
    assert.equal(secure.values.get(AUTH_TOKEN_KEY), "token-a");
    assert.equal(
        secure.values.get(AUTH_TOKEN_STORAGE_OWNER_KEY),
        "secure",
    );
    assert.equal(legacy.values.has(AUTH_TOKEN_KEY), false);

    const secureWrite = secure.calls.findIndex(
        ([operation, key]) =>
            operation === "set" && key === AUTH_TOKEN_KEY,
    );
    const legacyRemove = legacy.calls.findIndex(
        ([operation, key]) =>
            operation === "remove" && key === AUTH_TOKEN_KEY,
    );

    assert.notEqual(secureWrite, -1);
    assert.notEqual(legacyRemove, -1);
});

test("secure token wins over a stale legacy token", async () => {
    const secure = createStore({
        [AUTH_TOKEN_KEY]: "token-b",
        [AUTH_TOKEN_STORAGE_OWNER_KEY]: "secure",
    });
    const legacy = createStore({
        [AUTH_TOKEN_KEY]: "token-a",
    });
    const tokenStorage = createNativeAuthTokenStorage(secure, legacy);

    assert.equal(await tokenStorage.get(), "token-b");
    assert.equal(legacy.values.has(AUTH_TOKEN_KEY), false);
});

test("secure migration write failure never returns the legacy token", async () => {
    const secure = createStore();
    const legacy = createStore({
        [AUTH_TOKEN_KEY]: "token-a",
    });
    secure.failures.set.add(AUTH_TOKEN_KEY);

    const tokenStorage = createNativeAuthTokenStorage(secure, legacy);

    await assert.rejects(
        tokenStorage.get(),
        /set failed: lfa_portal_token/,
    );
    assert.equal(legacy.values.get(AUTH_TOKEN_KEY), "token-a");

    await assert.rejects(
        tokenStorage.get(),
        /unavailable for this application lifetime/,
    );
});

test("legacy deletion failure after secure migration fails closed", async () => {
    const secure = createStore();
    const legacy = createStore({
        [AUTH_TOKEN_KEY]: "token-a",
    });
    legacy.failures.remove.add(AUTH_TOKEN_KEY);

    const tokenStorage = createNativeAuthTokenStorage(secure, legacy);

    await assert.rejects(
        tokenStorage.get(),
        /remove failed: lfa_portal_token/,
    );
    assert.equal(secure.values.get(AUTH_TOKEN_KEY), "token-a");
    assert.equal(legacy.values.get(AUTH_TOKEN_KEY), "token-a");

    await assert.rejects(
        tokenStorage.get(),
        /unavailable for this application lifetime/,
    );

    legacy.failures.remove.delete(AUTH_TOKEN_KEY);

    const restartedStorage = createNativeAuthTokenStorage(
        secure,
        legacy,
    );

    assert.equal(await restartedStorage.get(), "token-a");
    assert.equal(legacy.values.has(AUTH_TOKEN_KEY), false);
});

test("remove clears secure and legacy copies", async () => {
    const secure = createStore({
        [AUTH_TOKEN_KEY]: "token-a",
        [AUTH_TOKEN_STORAGE_OWNER_KEY]: "secure",
    });
    const legacy = createStore({
        [AUTH_TOKEN_KEY]: "legacy-a",
    });
    const tokenStorage = createNativeAuthTokenStorage(secure, legacy);

    await tokenStorage.remove();

    assert.equal(secure.values.has(AUTH_TOKEN_KEY), false);
    assert.equal(legacy.values.has(AUTH_TOKEN_KEY), false);
    assert.equal(
        secure.values.get(AUTH_TOKEN_STORAGE_OWNER_KEY),
        "cleared",
    );
    assert.equal(await tokenStorage.get(), null);
});

test("remove attempts both physical deletions when one fails", async () => {
    const secure = createStore({
        [AUTH_TOKEN_KEY]: "token-a",
    });
    const legacy = createStore({
        [AUTH_TOKEN_KEY]: "legacy-a",
    });
    secure.failures.remove.add(AUTH_TOKEN_KEY);

    const tokenStorage = createNativeAuthTokenStorage(secure, legacy);

    await assert.rejects(
        tokenStorage.remove(),
        /remove failed: lfa_portal_token/,
    );

    assert.equal(legacy.values.has(AUTH_TOKEN_KEY), false);
    assert.equal(await tokenStorage.get(), null);
});

test("cleared marker prevents stale legacy-token resurrection after restart", async () => {
    const secure = createStore({
        [AUTH_TOKEN_STORAGE_OWNER_KEY]: "cleared",
    });
    const legacy = createStore({
        [AUTH_TOKEN_KEY]: "token-a",
    });
    const tokenStorage = createNativeAuthTokenStorage(secure, legacy);

    assert.equal(await tokenStorage.get(), null);
    assert.equal(legacy.values.has(AUTH_TOKEN_KEY), false);
});

for (const {
  name,
  failSecureMarker,
  failSecureDelete,
  failLegacyDelete,
} of [
  {
    name: "secure marker and secure deletion fail",
    failSecureMarker: true,
    failSecureDelete: true,
    failLegacyDelete: false,
  },
  {
    name: "secure marker succeeds but secure deletion fails",
    failSecureMarker: false,
    failSecureDelete: true,
    failLegacyDelete: false,
  },
  {
    name: "secure marker fails but secure deletion succeeds",
    failSecureMarker: true,
    failSecureDelete: false,
    failLegacyDelete: false,
  },
  {
    name: "secure marker and legacy deletion fail",
    failSecureMarker: true,
    failSecureDelete: false,
    failLegacyDelete: true,
  },
]) {
  test(`removal remains fail-closed after restart when ${name}`, async () => {
    const secure = createStore({
      [AUTH_TOKEN_KEY]: "token-a",
      [AUTH_TOKEN_STORAGE_OWNER_KEY]: "secure",
    });
    const legacy = createStore({
      [AUTH_TOKEN_KEY]: "legacy-a",
    });

    if (failSecureMarker) {
      secure.failures.set.add(AUTH_TOKEN_STORAGE_OWNER_KEY);
    }

    if (failSecureDelete) {
      secure.failures.remove.add(AUTH_TOKEN_KEY);
    }

    if (failLegacyDelete) {
      legacy.failures.remove.add(AUTH_TOKEN_KEY);
    }

    const storage = createNativeAuthTokenStorage(secure, legacy);

    await assert.rejects(storage.remove());

    secure.failures.set.clear();
    secure.failures.remove.clear();
    legacy.failures.remove.clear();

    const restartedStorage = createNativeAuthTokenStorage(
      secure,
      legacy,
    );

    assert.equal(await restartedStorage.get(), null);
  });
}

test("replacement login removes redundant cleared tombstone and survives restart", async () => {
  const secure = createStore({
    [AUTH_TOKEN_STORAGE_OWNER_KEY]: "cleared",
  });

  const legacy = createStore({
    [AUTH_TOKEN_STORAGE_OWNER_KEY]: "cleared",
    [AUTH_TOKEN_KEY]: "token-a",
  });

  const tokenStorage = createNativeAuthTokenStorage(
    secure,
    legacy,
  );

  assert.equal(await tokenStorage.get(), null);

  await tokenStorage.set("token-b");

  assert.equal(
    secure.values.get(AUTH_TOKEN_KEY),
    "token-b",
  );
  assert.equal(
    secure.values.get(AUTH_TOKEN_STORAGE_OWNER_KEY),
    "secure",
  );
  assert.equal(
    legacy.values.has(AUTH_TOKEN_STORAGE_OWNER_KEY),
    false,
  );
  assert.equal(
    legacy.values.has(AUTH_TOKEN_KEY),
    false,
  );

  const restartedStorage = createNativeAuthTokenStorage(
    secure,
    legacy,
  );

  assert.equal(await restartedStorage.get(), "token-b");
});

test("replacement login lifts a prior current-process cleared state", async () => {
    const secure = createStore({
        [AUTH_TOKEN_KEY]: "token-a",
        [AUTH_TOKEN_STORAGE_OWNER_KEY]: "secure",
    });
    const legacy = createStore();
    const tokenStorage = createNativeAuthTokenStorage(secure, legacy);

    await tokenStorage.remove();
    assert.equal(await tokenStorage.get(), null);

    await tokenStorage.set("token-b");

    assert.equal(await tokenStorage.get(), "token-b");
    assert.equal(secure.values.get(AUTH_TOKEN_KEY), "token-b");
});


test("default web adapter delegates the token key to general storage", async () => {
    const source = await readFile(
        new URL("./authTokenStorage.ts", import.meta.url),
        "utf8",
    );

    assert.match(
        source,
        /AUTH_TOKEN_KEY = "lfa_portal_token"/,
    );
    assert.match(source, /storage\.get\(AUTH_TOKEN_KEY\)/);
    assert.match(source, /storage\.set\(AUTH_TOKEN_KEY,\s*token\)/);
    assert.match(source, /storage\.remove\(AUTH_TOKEN_KEY\)/);
});
