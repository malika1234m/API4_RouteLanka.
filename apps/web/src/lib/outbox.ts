/**
 * The driver's outbox: records made on the phone wait here until they reach the server.
 * IndexedDB survives a page reload and a phone restart, which localStorage can't promise for a PWA.
 */
import type { FieldEvent } from "@routelanka/domain";

const DB = "routelanka";
const STORE = "outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r ? (r as IDBRequest<T>).result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export const outboxAll = async (): Promise<FieldEvent[]> => ((await tx("readonly", (s) => s.getAll())) as FieldEvent[] | undefined)?.sort((a, b) => a.at.localeCompare(b.at)) ?? [];
export const outboxAdd = (e: FieldEvent) => tx("readwrite", (s) => void s.put(e));
export const outboxRemove = (ids: string[]) => tx("readwrite", (s) => void ids.forEach((id) => s.delete(id)));
