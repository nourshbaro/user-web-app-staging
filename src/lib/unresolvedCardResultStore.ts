import type { UnresolvedCardResult, UnresolvedCardResultStore } from "@/lib/paymentOutcomeLock";

/**
 * Persistence for unresolved card-payment markers (see `paymentOutcomeLock`).
 * Pure module: key/value backends are injected, so it runs under Node.
 *
 * What is stored. Only a marker: account, cart session, time, a support
 * reference when one was readable, and a key. Never the payment JWT, billing
 * details or holder names (Step 1 has no replay, so nothing needs them).
 * Version-1 records, which held those, are still read, and are rewritten as
 * markers once they have been read.
 *
 * Two stores.
 * - primary: SecureStore on native; web localStorage.
 * - ledger: AsyncStorage on native; web localStorage under its own keys.
 *   It holds what the primary could not take: markers whose primary write
 *   failed (`pending`) and keys whose primary removal failed (`resolved`).
 * A marker is durable when either store accepted it; a removal is durable
 * when either the primary removed it or the ledger recorded it as resolved.
 * Both failing is reported to the caller, never assumed.
 *
 * Size. Values are written as ASCII-only chunks of at most `CHUNK_LENGTH`
 * bytes plus a manifest (some iOS releases rejected SecureStore values over
 * ~2048 bytes). A reader trusts a manifest only when all its chunks are
 * present and add up to its length; anything else is unreadable, and the
 * caller fails closed.
 */

export type KeyValueBackend = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

const PRIMARY_PREFIX = "lfa_card_result";
const LEDGER_PREFIX = "lfa_card_result_ledger";
const MANIFEST_VERSION = 1;
const LEGACY_RECORD_VERSION = 1;
const RECORD_VERSION = 2;
const LEDGER_VERSION = 1;
/** Bytes per stored value: under the historical ~2048-byte iOS ceiling. */
export const CHUNK_LENGTH = 1800;
/** Upper bound for one serialized record; larger writes are refused. */
export const MAX_RECORD_LENGTH = 96 * 1024;

type Manifest = { version: number; generation: string; count: number; length: number };

let generationSequence = 0;

/**
 * A backend over web localStorage that fails when storage is unavailable.
 * Unlike the app's general `storage` adapter, it never falls back to memory:
 * a write that would not survive a reload must not count as saved.
 */
export function createWebStorageBackend(resolve: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | null | undefined): KeyValueBackend {
  const local = () => {
    const found = resolve();
    if (!found) throw new Error("Durable web storage is unavailable.");
    return found;
  };
  return {
    get: async (key) => local().getItem(key),
    set: async (key, value) => {
      local().setItem(key, value);
    },
    remove: async (key) => {
      local().removeItem(key);
    },
  };
}

/** JSON with every non-ASCII character escaped, so one character is one byte. */
function asciiJson(value: unknown) {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function parseManifest(raw: string): Manifest {
  const value = JSON.parse(raw) as Partial<Manifest>;
  if (
    value?.version !== MANIFEST_VERSION
    || typeof value.generation !== "string"
    || !/^[a-z0-9]+$/.test(value.generation)
    || !Number.isInteger(value.count)
    || (value.count as number) < 1
    || !Number.isInteger(value.length)
    || (value.length as number) < 1
  ) {
    throw new Error("Unreadable card result manifest.");
  }
  return value as Manifest;
}

/** Chunked string slots over a key/value backend. Reads throw on anything incomplete. */
export function createChunkedSlots(backend: KeyValueBackend, prefix = PRIMARY_PREFIX) {
  // SecureStore keys may contain only alphanumerics, ".", "-" and "_".
  const slotKey = (slot: string) => `${prefix}.${slot.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const chunkKey = (slot: string, generation: string, index: number) => `${slotKey(slot)}.${generation}.${index}`;

  async function read(slot: string): Promise<string | null> {
    const raw = await backend.get(slotKey(slot));
    if (raw === null) return null;
    const manifest = parseManifest(raw);
    const chunks: string[] = [];
    for (let index = 0; index < manifest.count; index += 1) {
      const chunk = await backend.get(chunkKey(slot, manifest.generation, index));
      if (chunk === null) throw new Error("Incomplete card result record.");
      chunks.push(chunk);
    }
    const value = chunks.join("");
    if (value.length !== manifest.length) throw new Error("Incomplete card result record.");
    return value;
  }

  async function previousManifest(slot: string) {
    try {
      const raw = await backend.get(slotKey(slot));
      return raw === null ? null : parseManifest(raw);
    } catch {
      return null;
    }
  }

  // Superseded chunk generations still to delete. A version-1 generation can
  // hold a payment JWT and personal details, so a failed deletion is kept
  // (persisted under `<slot>.gc`, and in memory if even that write fails)
  // and retried by `collect`, never forgotten.
  const gcKey = (slot: string) => `${slotKey(slot)}.gc`;
  const orphans = new Map<string, Manifest[]>();

  const sameGeneration = (a: Manifest, b: Manifest) => a.generation === b.generation;

  async function readGarbage(slot: string): Promise<Manifest[]> {
    const raw = await backend.get(gcKey(slot)).catch(() => null);
    if (raw === null) return [];
    try {
      const list = JSON.parse(raw) as unknown;
      return Array.isArray(list) ? list.map((entry) => parseManifest(JSON.stringify(entry))) : [];
    } catch {
      return [];
    }
  }

  async function deleteGeneration(slot: string, manifest: Manifest) {
    let complete = true;
    for (let index = 0; index < manifest.count; index += 1) {
      try {
        await backend.remove(chunkKey(slot, manifest.generation, index));
      } catch {
        complete = false;
      }
    }
    return complete;
  }

  async function keepGarbage(slot: string, remaining: Manifest[]) {
    orphans.set(slot, remaining);
    try {
      if (remaining.length) await backend.set(gcKey(slot), JSON.stringify(remaining));
      else await backend.remove(gcKey(slot));
    } catch {
      // Kept in memory; retried by the next collect in this process.
    }
  }

  async function removeChunks(slot: string, manifest: Manifest | null) {
    if (!manifest || (await deleteGeneration(slot, manifest))) return;
    const known = [...(orphans.get(slot) ?? []), ...(await readGarbage(slot))];
    if (!known.some((entry) => sameGeneration(entry, manifest))) known.push(manifest);
    await keepGarbage(slot, known.filter((entry, index) => known.findIndex((other) => sameGeneration(other, entry)) === index));
  }

  /** Retries deletion of every superseded generation recorded for this slot. Never throws. */
  async function collect(slot: string) {
    const known = [...(orphans.get(slot) ?? []), ...(await readGarbage(slot))];
    const unique = known.filter((entry, index) => known.findIndex((other) => sameGeneration(other, entry)) === index);
    if (!unique.length) return;
    const current = await previousManifest(slot);
    const remaining: Manifest[] = [];
    for (const entry of unique) {
      if (current && sameGeneration(current, entry)) continue; // never delete the live generation
      if (!(await deleteGeneration(slot, entry))) remaining.push(entry);
    }
    await keepGarbage(slot, remaining);
  }

  /** Superseded generations still awaiting deletion (for tests and diagnostics). */
  async function pendingGarbage(slot: string) {
    const known = [...(orphans.get(slot) ?? []), ...(await readGarbage(slot))];
    return known.filter((entry, index) => known.findIndex((other) => sameGeneration(other, entry)) === index);
  }

  /** Writes every chunk, then the manifest. Rejects if any write fails. */
  async function write(slot: string, value: string) {
    if (!value || value.length > MAX_RECORD_LENGTH || /[^\x00-\x7e]/.test(value)) {
      throw new Error("Card result record cannot be stored.");
    }
    const previous = await previousManifest(slot);
    generationSequence += 1;
    const generation = `${Date.now().toString(36)}${generationSequence.toString(36)}`;
    const count = Math.ceil(value.length / CHUNK_LENGTH);
    for (let index = 0; index < count; index += 1) {
      await backend.set(chunkKey(slot, generation, index), value.slice(index * CHUNK_LENGTH, (index + 1) * CHUNK_LENGTH));
    }
    const manifest: Manifest = { version: MANIFEST_VERSION, generation, count, length: value.length };
    await backend.set(slotKey(slot), JSON.stringify(manifest));
    if (previous && previous.generation !== generation) await removeChunks(slot, previous);
  }

  /** Removes the manifest (which makes the record absent), then its chunks. Rejects if the manifest stays. */
  async function remove(slot: string) {
    const previous = await previousManifest(slot);
    await backend.remove(slotKey(slot));
    await removeChunks(slot, previous);
  }

  return { read, write, remove, collect, pendingGarbage };
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** A marker (version 2), or the marker part of a version-1 entry: its JWT and context are dropped. */
function parseMarker(value: unknown, accountId: string): UnresolvedCardResult {
  const entry = value as Partial<UnresolvedCardResult> | null;
  if (
    !entry
    || !isText(entry.key)
    || entry.accountId !== accountId
    || !isText(entry.sessionId)
    || typeof entry.recordedAt !== "number"
    || !Number.isFinite(entry.recordedAt)
    || !(entry.reference === null || entry.reference === undefined || isText(entry.reference))
  ) {
    throw new Error("Unreadable card result entry.");
  }
  return {
    key: entry.key,
    accountId,
    sessionId: entry.sessionId,
    recordedAt: entry.recordedAt,
    reference: entry.reference ?? null,
  };
}

type PrimaryRecord = { markers: UnresolvedCardResult[]; legacy: boolean };
type Ledger = { pending: UnresolvedCardResult[]; resolved: string[] };

function parsePrimary(raw: string | null, accountId: string): PrimaryRecord {
  if (raw === null) return { markers: [], legacy: false };
  const value = JSON.parse(raw) as { version?: unknown; accountId?: unknown; results?: unknown };
  const legacy = value?.version === LEGACY_RECORD_VERSION;
  if ((!legacy && value?.version !== RECORD_VERSION) || value.accountId !== accountId || !Array.isArray(value.results)) {
    throw new Error("Unreadable card result record.");
  }
  return { markers: value.results.map((entry) => parseMarker(entry, accountId)), legacy };
}

function parseLedger(raw: string | null, accountId: string): Ledger {
  if (raw === null) return { pending: [], resolved: [] };
  const value = JSON.parse(raw) as { version?: unknown; accountId?: unknown; pending?: unknown; resolved?: unknown };
  if (
    value?.version !== LEDGER_VERSION
    || value.accountId !== accountId
    || !Array.isArray(value.pending)
    || !Array.isArray(value.resolved)
    || !value.resolved.every(isText)
  ) {
    throw new Error("Unreadable card result ledger.");
  }
  return { pending: value.pending.map((entry) => parseMarker(entry, accountId)), resolved: value.resolved as string[] };
}

/** Only the marker fields are ever serialized, whatever the caller passed. */
function markerOnly(entry: UnresolvedCardResult): UnresolvedCardResult {
  return { key: entry.key, accountId: entry.accountId, sessionId: entry.sessionId, recordedAt: entry.recordedAt, reference: entry.reference };
}

/**
 * Runs a read-modify-write step until a read confirms it (the step returns
 * true when the state already holds), at most `attempts` writes. Rejects if
 * it never confirms or any step rejects.
 */
async function untilConfirmed(step: () => Promise<boolean>, attempts = 3) {
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    if (await step()) return;
  }
  throw new Error("Card result change could not be confirmed.");
}

function withoutDuplicates(markers: UnresolvedCardResult[]) {
  return markers.filter((marker, index) => markers.findIndex((other) => other.key === marker.key) === index);
}

export function createUnresolvedCardResultStore({ primary, ledger }: { primary: KeyValueBackend; ledger: KeyValueBackend }): UnresolvedCardResultStore {
  const primarySlots = createChunkedSlots(primary, PRIMARY_PREFIX);
  const ledgerSlots = createChunkedSlots(ledger, LEDGER_PREFIX);

  const readPrimary = async (accountId: string) => parsePrimary(await primarySlots.read(accountId), accountId);
  const readLedger = async (accountId: string) => parseLedger(await ledgerSlots.read(accountId), accountId);

  const writePrimary = async (accountId: string, markers: UnresolvedCardResult[]) => {
    if (!markers.length) await primarySlots.remove(accountId);
    else await primarySlots.write(accountId, asciiJson({ version: RECORD_VERSION, accountId, results: markers.map(markerOnly) }));
  };
  const writeLedger = async (accountId: string, next: Ledger) => {
    if (!next.pending.length && !next.resolved.length) await ledgerSlots.remove(accountId);
    else await ledgerSlots.write(accountId, asciiJson({ version: LEDGER_VERSION, accountId, pending: next.pending.map(markerOnly), resolved: next.resolved }));
  };

  /**
   * Markers that still block: (primary ∪ ledger.pending) − ledger.resolved.
   * Throws if either store holds something unreadable.
   */
  const read = async (accountId: string) => {
    const record = await readPrimary(accountId);
    const book = await readLedger(accountId);
    const markers = withoutDuplicates([...record.markers, ...book.pending]).filter((marker) => !book.resolved.includes(marker.key));
    const needsCompaction = record.legacy || book.pending.length > 0 || book.resolved.length > 0;
    return { markers, needsCompaction };
  };

  return {
    read,

    /**
     * Durable in the primary, else in the ledger; rejects if neither accepted
     * it. An unreadable record is never overwritten. Each write is read back:
     * another tab writing the same slot in between cannot silently drop it.
     */
    async add(accountId, entry) {
      try {
        await untilConfirmed(async () => {
          const record = await readPrimary(accountId);
          if (record.markers.some((marker) => marker.key === entry.key)) return true;
          await writePrimary(accountId, [...record.markers, entry]);
          return false;
        });
        return "primary";
      } catch {
        await untilConfirmed(async () => {
          const book = await readLedger(accountId);
          if (book.pending.some((marker) => marker.key === entry.key)) return true;
          await writeLedger(accountId, { pending: [...book.pending, entry], resolved: book.resolved });
          return false;
        });
        return "ledger";
      }
    },

    /** Removed from the primary (and the ledger), else recorded as resolved in the ledger; rejects if neither. Read back like `add`. */
    async remove(accountId, key) {
      try {
        await untilConfirmed(async () => {
          const record = await readPrimary(accountId);
          if (!record.markers.some((marker) => marker.key === key)) return true;
          await writePrimary(accountId, record.markers.filter((marker) => marker.key !== key));
          return false;
        });
      } catch {
        await untilConfirmed(async () => {
          const book = await readLedger(accountId);
          if (book.resolved.includes(key)) return true;
          await writeLedger(accountId, { pending: book.pending.filter((marker) => marker.key !== key), resolved: [...book.resolved, key] });
          return false;
        });
        return "tombstoned";
      }
      // The primary no longer has it; a pending copy in the ledger must go too.
      const book = await readLedger(accountId).catch(() => null);
      if (book === null) {
        // The ledger is unreadable: it may still hold a pending copy, so tombstoning is impossible there.
        // The primary removal stands; the reader fails closed on the unreadable ledger.
        return "removed";
      }
      if (book.pending.some((marker) => marker.key === key)) {
        // Rejects if it fails: the pending copy would make the marker block again after a relaunch.
        await writeLedger(accountId, { pending: book.pending.filter((marker) => marker.key !== key), resolved: book.resolved });
      }
      return "removed";
    },

    /**
     * Rewrites the primary as markers only (dropping a version-1 record's JWT
     * and context), folds the ledger into it, then clears the ledger. Best
     * effort: on any failure both stores stay as they were.
     */
    async compact(accountId) {
      // First retry deleting superseded chunks (a version-1 generation can hold a JWT and personal details).
      await primarySlots.collect(accountId);
      await ledgerSlots.collect(accountId);
      const { markers, needsCompaction } = await read(accountId);
      if (!needsCompaction) return;
      await writePrimary(accountId, markers);
      await writeLedger(accountId, { pending: [], resolved: [] });
    },
  };
}
