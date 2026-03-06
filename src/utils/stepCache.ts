import type { ModelFileData } from '../store/useStore';
import type { StepWorkerResult } from './stepTypes';

const STEP_CACHE_DB = 'hurt-step-cache';
const STEP_CACHE_STORE = 'entries';
const STEP_CACHE_VERSION = 1;
const STEP_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const STEP_CACHE_MAX_ENTRIES = 10;
const STEP_CACHE_FORMAT_VERSION = 3;

interface StepCacheRecord {
  key: string;
  bytes: number;
  createdAt: number;
  lastAccessedAt: number;
  value: StepWorkerResult;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function openStepCacheDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(STEP_CACHE_DB, STEP_CACHE_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STEP_CACHE_STORE)) {
        db.createObjectStore(STEP_CACHE_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open STEP cache database'));
  });

  return dbPromise;
}

function estimateStepResultBytes(result: StepWorkerResult): number {
  let bytes = 0;
  for (const mesh of result.meshes) {
    bytes += mesh.position?.byteLength ?? 0;
    bytes += mesh.normal?.byteLength ?? 0;
    bytes += mesh.index?.byteLength ?? 0;
  }
  return bytes;
}

export function createStepCacheKey(file: ModelFileData, preview: boolean): string {
  return [
    `v${STEP_CACHE_FORMAT_VERSION}`,
    preview ? 'preview' : 'full',
    file.url,
    String(file.size ?? 0),
  ].join('|');
}

export async function getStepCacheValue(key: string): Promise<StepWorkerResult | null> {
  if (typeof indexedDB === 'undefined') return null;

  try {
    const db = await openStepCacheDb();
    const tx = db.transaction(STEP_CACHE_STORE, 'readwrite');
    const store = tx.objectStore(STEP_CACHE_STORE);
    const record = (await requestToPromise(store.get(key))) as StepCacheRecord | undefined;

    if (!record?.value) {
      await transactionDone(tx);
      return null;
    }

    record.lastAccessedAt = Date.now();
    store.put(record);
    await transactionDone(tx);
    return record.value;
  } catch {
    return null;
  }
}

async function pruneStepCache(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STEP_CACHE_STORE, 'readwrite');
  const store = tx.objectStore(STEP_CACHE_STORE);
  const records = (await requestToPromise(store.getAll())) as StepCacheRecord[];
  let totalBytes = records.reduce((sum, record) => sum + (record.bytes || 0), 0);

  if (records.length <= STEP_CACHE_MAX_ENTRIES && totalBytes <= STEP_CACHE_MAX_BYTES) {
    await transactionDone(tx);
    return;
  }

  records.sort((a, b) => (a.lastAccessedAt || 0) - (b.lastAccessedAt || 0));
  let remainingEntries = records.length;

  for (const record of records) {
    if (remainingEntries <= STEP_CACHE_MAX_ENTRIES && totalBytes <= STEP_CACHE_MAX_BYTES) {
      break;
    }
    store.delete(record.key);
    totalBytes -= record.bytes || 0;
    remainingEntries--;
  }

  await transactionDone(tx);
}

export async function setStepCacheValue(
  key: string,
  value: StepWorkerResult
): Promise<void> {
  if (typeof indexedDB === 'undefined') return;

  const bytes = estimateStepResultBytes(value);
  if (bytes <= 0 || bytes > STEP_CACHE_MAX_BYTES) return;

  try {
    const db = await openStepCacheDb();
    const tx = db.transaction(STEP_CACHE_STORE, 'readwrite');
    const store = tx.objectStore(STEP_CACHE_STORE);
    const now = Date.now();

    const record: StepCacheRecord = {
      key,
      value,
      bytes,
      createdAt: now,
      lastAccessedAt: now,
    };

    store.put(record);
    await transactionDone(tx);
    await pruneStepCache(db);
  } catch {
    // Ignore cache write failures (quota, private mode, etc.).
  }
}
