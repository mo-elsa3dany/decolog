import {
  db,
  type DiveRecord,
  type DiverProfile,
  type SupportMessage,
  type GasKind,
} from './db';

export type StoredDive = DiveRecord;
export type ProfileInput = {
  fullName: string;
  agency: string;
  certLevel: string;
  certNumber: string;
  country: string;
  email: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyNotes: string;
  notes: string;
};

export type SupportInput = {
  subject: string;
  message: string;
  includeDevice: boolean;
  deviceInfo?: string;
};

// ---------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------
export async function seedIfEmpty(): Promise<void> {
  const count = await db.dives.count();
  if (count > 0) return;

  const now = Date.now();

  const sample: DiveRecord[] = [
    {
      date: '2025-10-12',
      site: 'BLUE HOLE',
      location: 'Eleuthera',
      depthMeters: 18,
      bottomTimeMin: 42,
      gas: 'EAN32',
      sacLpm: 17.8,
      startBar: 200,
      endBar: 80,
      cylinderLiters: 11.1,
      notes: 'Sample training dive',
      createdAt: now - 2 * 86400000,
      updatedAt: now - 2 * 86400000,
    },
    {
      date: '2025-10-10',
      site: 'REEF DROP',
      location: 'Eleuthera',
      depthMeters: 14,
      bottomTimeMin: 38,
      gas: 'AIR',
      sacLpm: 16.2,
      startBar: 210,
      endBar: 90,
      cylinderLiters: 11.1,
      notes: 'Sample reef dive',
      createdAt: now - 4 * 86400000,
      updatedAt: now - 4 * 86400000,
    },
  ];

  await db.dives.bulkAdd(sample);
}

// ---------------------------------------------------------------------
// Dives
// ---------------------------------------------------------------------
export async function getDives(): Promise<StoredDive[]> {
  const list = await db.dives.orderBy('createdAt').reverse().toArray();
  return list;
}

export interface NewDiveInput {
  date: string;
  site: string;
  location?: string;
  depthMeters: number;
  bottomTimeMin: number;
  gas: GasKind;
  sacLpm?: number;
  startBar?: number;
  endBar?: number;
  cylinderLiters?: number;
  notes?: string;
}

export async function addDive(input: NewDiveInput): Promise<StoredDive> {
  const now = Date.now();
  const record: DiveRecord = {
    ...input,
    createdAt: now,
    updatedAt: now,
  };
  const id = await db.dives.add(record);
  return { ...record, id };
}

export async function updateDive(
  id: number,
  changes: Partial<NewDiveInput>,
): Promise<void> {
  await db.dives.update(id, {
    ...changes,
    updatedAt: Date.now(),
  });
}

export async function deleteDive(id: number): Promise<void> {
  await db.dives.delete(id);
}

// ---------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------
export async function getProfile(): Promise<DiverProfile | null> {
  const profile = await db.profile.get(1);
  return profile ?? null;
}

export async function saveProfile(input: ProfileInput): Promise<DiverProfile> {
  const payload: DiverProfile = {
    ...input,
    id: 1,
    updatedAt: Date.now(),
  };
  await db.profile.put(payload);
  return payload;
}

// ---------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------
export async function saveSupportMessage(
  input: SupportInput,
): Promise<SupportMessage> {
  const payload: SupportMessage = {
    ...input,
    deviceInfo: input.includeDevice ? input.deviceInfo : undefined,
    createdAt: Date.now(),
    sent: false,
  };
  const id = await db.support.add(payload);
  return { ...payload, id };
}

// ---------------------------------------------------------------------
// License (localStorage only)
// ---------------------------------------------------------------------
export type LicenseTier = 'training' | 'pro_local' | 'pro_cloud';
export interface LicenseState {
  tier: LicenseTier;
  activatedAt?: number;
}

const LICENSE_KEY = 'decolog.license';

export function getLicense(): LicenseState {
  if (typeof window === 'undefined') {
    return { tier: 'training' };
  }
  try {
    const raw = window.localStorage.getItem(LICENSE_KEY);
    if (!raw) return { tier: 'training' };
    const parsed = JSON.parse(raw) as LicenseState;
    if (!parsed || !parsed.tier) return { tier: 'training' };
    return parsed;
  } catch {
    return { tier: 'training' };
  }
}

export function saveLicense(next: LicenseState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LICENSE_KEY, JSON.stringify(next));
}

export function setDevProLocal(): LicenseState {
  const next: LicenseState = { tier: 'pro_local', activatedAt: Date.now() };
  saveLicense(next);
  return next;
}

export function setDevProCloud(): LicenseState {
  const next: LicenseState = { tier: 'pro_cloud', activatedAt: Date.now() };
  saveLicense(next);
  return next;
}

// ---------------------------------------------------------------------
// Cloud sync config (local only stub)
// ---------------------------------------------------------------------
export type SyncStatus = 'idle' | 'ok' | 'error';

export interface SyncConfig {
  cloudSyncEnabled: boolean;
  lastSyncAt?: number;
  lastSyncStatus: SyncStatus;
}

const SYNC_KEY = 'decolog.sync';

export function getSyncConfig(): SyncConfig {
  if (typeof window === 'undefined') {
    return { cloudSyncEnabled: false, lastSyncStatus: 'idle' };
  }
  try {
    const raw = window.localStorage.getItem(SYNC_KEY);
    if (!raw) return { cloudSyncEnabled: false, lastSyncStatus: 'idle' };
    const parsed = JSON.parse(raw) as SyncConfig;
    return {
      cloudSyncEnabled: !!parsed.cloudSyncEnabled,
      lastSyncAt: parsed.lastSyncAt,
      lastSyncStatus: parsed.lastSyncStatus ?? 'idle',
    };
  } catch {
    return { cloudSyncEnabled: false, lastSyncStatus: 'idle' };
  }
}

export function saveSyncConfig(next: SyncConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SYNC_KEY, JSON.stringify(next));
}
