// TODO: Replace this temporary file-backed store with a real database-backed implementation.
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface LicenseRecord {
  deviceId: string;
  subscriptionId: string;
  status: string;
  updatedAt: number;
}

const DATA_DIR = path.join(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'licenses.json');

let cache: LicenseRecord[] | null = null;

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readStore(): Promise<LicenseRecord[]> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw) as LicenseRecord[];
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function writeStore(records: LicenseRecord[]): Promise<void> {
  cache = records;
  try {
    await ensureDataDir();
    await fs.writeFile(DATA_FILE, JSON.stringify(records, null, 2), 'utf8');
  } catch (error) {
    console.warn('licenseStore: failed to persist license data; data may be ephemeral', error);
  }
}

export async function upsertLicense(data: {
  deviceId: string;
  subscriptionId: string;
  status: string;
}): Promise<void> {
  const store = await readStore();
  const idx = store.findIndex((item) => item.deviceId === data.deviceId);
  const record: LicenseRecord = {
    ...data,
    updatedAt: Date.now(),
  };
  if (idx >= 0) {
    store[idx] = record;
  } else {
    store.push(record);
  }
  await writeStore(store);
}

export async function getLicense(deviceId: string): Promise<LicenseRecord | null> {
  const store = await readStore();
  const found = store.find((item) => item.deviceId === deviceId);
  return found ?? null;
}
