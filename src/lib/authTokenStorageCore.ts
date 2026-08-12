export const AUTH_TOKEN_KEY = "lfa_portal_token";
export const AUTH_TOKEN_STORAGE_OWNER_KEY =
    "lfa_portal_token.storage_owner";

const SECURE_OWNER = "secure";
const CLEARED_OWNER = "cleared";

export type AuthTokenKeyValueStorage = {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
};

type RuntimeState = "normal" | "cleared" | "failed";

export function createNativeAuthTokenStorage(
    secureStorage: AuthTokenKeyValueStorage,
    legacyStorage: AuthTokenKeyValueStorage,
) {
    let runtimeState: RuntimeState = "normal";

    async function removePhysicalCopies() {
        let firstError: unknown;

        try {
            await secureStorage.remove(AUTH_TOKEN_KEY);
        } catch (error) {
            firstError = error;
        }

        try {
            await legacyStorage.remove(AUTH_TOKEN_KEY);
        } catch (error) {
            firstError ??= error;
        }

        if (firstError !== undefined) throw firstError;
    }

    return {
        async get() {
            if (runtimeState === "cleared") return null;
            if (runtimeState === "failed") {
                throw new Error(
                    "Authentication token storage is unavailable for this application lifetime.",
                );
            }

            try {
                const legacyOwner = await legacyStorage.get(
                    AUTH_TOKEN_STORAGE_OWNER_KEY,
                );

                if (legacyOwner === CLEARED_OWNER) {
                    await removePhysicalCopies();
                    runtimeState = "cleared";
                    return null;
                }

                const owner = await secureStorage.get(
                    AUTH_TOKEN_STORAGE_OWNER_KEY,
                );

                if (owner === CLEARED_OWNER) {
                    await removePhysicalCopies();
                    runtimeState = "cleared";
                    return null;
                }

                const secureToken = await secureStorage.get(AUTH_TOKEN_KEY);

                if (secureToken !== null) {
                    if (owner !== SECURE_OWNER) {
                        await secureStorage.set(
                            AUTH_TOKEN_STORAGE_OWNER_KEY,
                            SECURE_OWNER,
                        );
                    }

                    await legacyStorage.remove(AUTH_TOKEN_KEY);
                    return secureToken;
                }

                if (owner === SECURE_OWNER) {
                    await legacyStorage.remove(AUTH_TOKEN_KEY);
                    return null;
                }

                const legacyToken = await legacyStorage.get(AUTH_TOKEN_KEY);

                if (legacyToken === null) {
                    await secureStorage.set(
                        AUTH_TOKEN_STORAGE_OWNER_KEY,
                        SECURE_OWNER,
                    );
                    return null;
                }

                await secureStorage.set(AUTH_TOKEN_KEY, legacyToken);
                await secureStorage.set(
                    AUTH_TOKEN_STORAGE_OWNER_KEY,
                    SECURE_OWNER,
                );
                await legacyStorage.remove(AUTH_TOKEN_KEY);

                return legacyToken;
            } catch (error) {
                runtimeState = "failed";
                throw error;
            }
        },

        async set(token: string) {
            await secureStorage.set(AUTH_TOKEN_KEY, token);
            await secureStorage.set(
                AUTH_TOKEN_STORAGE_OWNER_KEY,
                SECURE_OWNER,
            );
            await legacyStorage.remove(AUTH_TOKEN_STORAGE_OWNER_KEY);
            await legacyStorage.remove(AUTH_TOKEN_KEY);
            runtimeState = "normal";
        },

        async remove() {
            runtimeState = "cleared";

            let firstError: unknown;

            try {
                await secureStorage.set(
                    AUTH_TOKEN_STORAGE_OWNER_KEY,
                    CLEARED_OWNER,
                );
            } catch (error) {
                firstError = error;
            }

            try {
                await legacyStorage.set(
                    AUTH_TOKEN_STORAGE_OWNER_KEY,
                    CLEARED_OWNER,
                );
            } catch (error) {
                firstError ??= error;
            }

            try {
                await secureStorage.remove(AUTH_TOKEN_KEY);
            } catch (error) {
                firstError ??= error;
            }

            try {
                await legacyStorage.remove(AUTH_TOKEN_KEY);
            } catch (error) {
                firstError ??= error;
            }

            if (firstError !== undefined) throw firstError;
        },
    };
}
