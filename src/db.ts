import Dexie, { type Table } from 'dexie';

export interface DiveRecord {
  id?: number;
  site: string;
  depth: number;
  time: number;
  startPressure: number;
  endPressure: number;
  cylLiters: number;
  sac: number;
  gas: string;
  createdAt: string;
}

export interface DiverProfile {
  id: number;
  name: string;
  agency: string;
  level: string;
  defaultCylinder: string;
}

class DecoLogDB extends Dexie {
  dives!: Table<DiveRecord, number>;
  profile!: Table<DiverProfile, number>;

  constructor() {
    super('DecoLogDB');

    // Initial schema (dives only)
    this.version(1).stores({
      dives: '++id,createdAt,site',
    });

    // Schema v2: add profile table
    this.version(2).stores({
      dives: '++id,createdAt,site',
      profile: 'id',
    });
  }
}

export const db = new DecoLogDB();
