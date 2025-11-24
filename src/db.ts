import Dexie, { type Table } from 'dexie';

export interface DiveRecord {
  id?: number;
  site: string;
  depth: number;
  time: number;
  sac: number;
  gas: string;
  createdAt: string;
}

class DecoLogDB extends Dexie {
  dives!: Table<DiveRecord, number>;

  constructor() {
    super('DecoLogDB');

    this.version(1).stores({
      dives: '++id, createdAt',
    });
  }
}

export const db = new DecoLogDB();
