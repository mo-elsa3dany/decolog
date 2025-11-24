const DB_NAME = 'DecoLogDB';
const STORE = 'dives';
const VERSION = 1;

const META_KEY = 'decolog.meta';

export interface StoredDive {
  id?: number;
  site: string;
  depth: number;        // max depth in meters
  time: number;         // bottom time in minutes
  startPressure: number; // bar
  endPressure: number;   // bar
  cylLiters: number;     // internal volume in liters
  sac: number;           // L/min at surface
  gas: string;
  createdAt: string;
}

type MetaState = {
  unlocked: boolean;
};

export function getMeta(): MetaState {
  if (typeof localStorage === 'undefined') {
    return { unlocked: false };
  }
  const raw = localStorage.getItem(META_KEY);
  if (!raw) return { unlocked: false };
  try {
    return JSON.parse(raw) as MetaState;
  } catch {
    return { unlocked: false };
  }
}

export function setUnlocked(value: boolean) {
  if (typeof localStorage === 'undefined') return;
  const meta = getMeta();
  meta.unlocked = value;
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export function isUnlocked(): boolean {
  return getMeta().unlocked === true;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getDives(): Promise<StoredDive[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();

    req.onsuccess = () => {
      const list = (req.result || []) as StoredDive[];
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function addDive(
  data: Omit<StoredDive, 'id' | 'createdAt'>
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.add({
      ...data,
      createdAt: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateDive(
  id: number,
  updates: Partial<Omit<StoredDive, 'id'>>
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const existing = getReq.result as StoredDive | undefined;
      if (!existing) {
        tx.abort();
        reject(new Error('Dive not found'));
        return;
      }
      const updated: StoredDive = {
        ...existing,
        ...updates,
        id, // ensure id is preserved
      };
      store.put(updated);
    };

    getReq.onerror = () => {
      reject(getReq.error);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteDive(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function seedIfEmpty(): Promise<StoredDive[]> {
  const existing = await getDives();
  if (existing.length > 0) return existing;

  // Assume AL80 ~11.1 L, sample pressures in bar
  await addDive({
    site: 'BLUE HOLE',
    depth: 18,
    time: 42,
    startPressure: 210,
    endPressure: 70,
    cylLiters: 11.1,
    sac: 17.8,
    gas: 'EAN32',
  });

  await addDive({
    site: 'REEF DROP',
    depth: 14,
    time: 38,
    startPressure: 200,
    endPressure: 80,
    cylLiters: 11.1,
    sac: 16.2,
    gas: 'AIR',
  });

  return getDives();
}
