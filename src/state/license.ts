export type LicenseMode = 'training' | 'pro' | 'cloud';

export interface LicenseState {
  mode: LicenseMode;
  activatedAt?: number;
}

const LICENSE_KEY = 'decolog.license';

const DEFAULT_LICENSE: LicenseState = { mode: 'training' };

function readFromStorage(): LicenseState {
  if (typeof window === 'undefined') return DEFAULT_LICENSE;

  try {
    const raw = window.localStorage.getItem(LICENSE_KEY);
    if (!raw) return DEFAULT_LICENSE;
    const parsed = JSON.parse(raw) as LicenseState & { tier?: 'training' | 'pro_local' | 'pro_cloud' };
    if (parsed?.mode) return parsed;
    if (parsed?.tier) {
      const migratedMode: LicenseMode =
        parsed.tier === 'pro_cloud'
          ? 'cloud'
          : parsed.tier === 'pro_local'
            ? 'pro'
            : 'training';
      const migrated: LicenseState = { mode: migratedMode, activatedAt: parsed.activatedAt };
      saveLicense(migrated);
      return migrated;
    }
    return DEFAULT_LICENSE;
  } catch {
    return DEFAULT_LICENSE;
  }
}

export function loadLicense(): LicenseState {
  return readFromStorage();
}

export function saveLicense(next: LicenseState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LICENSE_KEY, JSON.stringify(next));
}

export function setLicenseMode(mode: LicenseMode, previous?: LicenseState): LicenseState {
  const activatedAt = mode === 'training' ? undefined : previous?.activatedAt ?? Date.now();
  const next: LicenseState = { mode, activatedAt };
  saveLicense(next);
  return next;
}
