import Dexie, { type Table } from 'dexie';

export type GasKind = 'AIR' | 'EAN32';

export interface DiveRecord {
  id?: number;
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
  createdAt: number;
  updatedAt?: number;
}

export interface DiverProfile {
  id?: number;
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
  updatedAt: number;
}

export interface SupportMessage {
  id?: number;
  subject: string;
  message: string;
  includeDevice: boolean;
  deviceInfo?: string;
  createdAt: number;
  sent: boolean;
}

class DecoLogDB extends Dexie {
  dives!: Table<DiveRecord, number>;
  profile!: Table<DiverProfile, number>;
  support!: Table<SupportMessage, number>;

  constructor() {
    super('DecoLogDB');

    this.version(1).stores({
      dives: '++id, date, createdAt',
      profile: 'id',
      support: '++id, createdAt, sent',
    });

    this.version(2)
      .stores({
        dives: '++id, date, location, createdAt',
        profile: 'id',
        support: '++id, createdAt, sent',
      })
      .upgrade((tx) =>
        tx.table('dives').toCollection().modify((dive: DiveRecord) => {
          if (!dive.location) {
            dive.location = '—';
          }
        }),
      );
  }
}

export const db = new DecoLogDB();
