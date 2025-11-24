import { db, type DiveRecord, type DiverProfile } from './db';

export type StoredDive = DiveRecord;

// One-time unlock key (free vs unlocked tier)
const UNLOCK_KEY = 'decolog.unlock';

export function isUnlocked(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(UNLOCK_KEY) === '1';
}

export function setUnlocked(value: boolean): void {
  if (typeof window === 'undefined') return;
  if (value) {
    window.localStorage.setItem(UNLOCK_KEY, '1');
  } else {
    window.localStorage.removeItem(UNLOCK_KEY);
  }
}

// Seed demo dives if database is empty
export async function seedIfEmpty(): Promise<StoredDive[]> {
  const count = await db.dives.count();
  if (count === 0) {
    const now = new Date();
    const baseDate = now.toISOString();

    const demo: DiveRecord[] = [
      {
        site: 'BLUE HOLE',
        depth: 18,
        time: 42,
        startPressure: 210,
        endPressure: 70,
        cylLiters: 11.1,
        sac: 17.8,
        gas: 'EAN32',
        createdAt: baseDate,
      },
      {
        site: 'REEF DROP',
        depth: 14,
        time: 38,
        startPressure: 210,
        endPressure: 80,
        cylLiters: 11.1,
        sac: 16.2,
        gas: 'AIR',
        createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24).toISOString(),
      },
    ];

    await db.dives.bulkAdd(demo);
  }

  return db.dives.toArray();
}

export async function getDives(): Promise<StoredDive[]> {
  return db.dives.toArray();
}

export async function addDive(input: {
  site: string;
  depth: number;
  time: number;
  startPressure: number;
  endPressure: number;
  cylLiters: number;
  sac: number;
  gas: string;
}): Promise<number> {
  const record: DiveRecord = {
    ...input,
    createdAt: new Date().toISOString(),
  };
  return db.dives.add(record);
}

export async function updateDive(
  id: number,
  patch: Partial<Omit<DiveRecord, 'id'>>,
): Promise<number> {
  return db.dives.update(id, patch);
}

export async function deleteDive(id: number): Promise<void> {
  await db.dives.delete(id);
}

// Diver profile API

export async function getProfile(): Promise<DiverProfile | undefined> {
  return db.profile.get(1);
}

export async function saveProfile(data: {
  name: string;
  agency: string;
  level: string;
  defaultCylinder: string;
}): Promise<void> {
  const profile: DiverProfile = {
    id: 1,
    name: data.name,
    agency: data.agency,
    level: data.level,
    defaultCylinder: data.defaultCylinder,
  };
  await db.profile.put(profile);
}
