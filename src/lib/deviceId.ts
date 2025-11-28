const DEVICE_ID_KEY = 'decolog_device_id';

let cachedDeviceId: string | null = null;

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const random = Math.random().toString(36).slice(2);
  const timestamp = Date.now().toString(36);
  return `decolog-${timestamp}-${random}`;
}

export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  if (typeof window === 'undefined') {
    cachedDeviceId = generateId();
    return cachedDeviceId;
  }

  try {
    const stored = window.localStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      cachedDeviceId = stored;
      return stored;
    }
    const next = generateId();
    window.localStorage.setItem(DEVICE_ID_KEY, next);
    cachedDeviceId = next;
    return next;
  } catch {
    cachedDeviceId = cachedDeviceId ?? generateId();
    return cachedDeviceId;
  }
}
