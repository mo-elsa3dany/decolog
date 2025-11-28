import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getLicense } from './licenseStore';

function extractDeviceId(req: VercelRequest): string | null {
  if (req.query.deviceId && typeof req.query.deviceId === 'string') {
    return req.query.deviceId;
  }
  if (req.body) {
    if (typeof req.body === 'string') {
      try {
        const parsed = JSON.parse(req.body) as { deviceId?: string };
        if (typeof parsed.deviceId === 'string') return parsed.deviceId;
      } catch {
        return null;
      }
    } else if (typeof req.body === 'object' && req.body != null) {
      const candidate = (req.body as { deviceId?: unknown }).deviceId;
      if (typeof candidate === 'string') return candidate;
    }
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const deviceId = extractDeviceId(req);
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  const license = await getLicense(deviceId);
  return res.status(200).json({
    active: Boolean(license?.status === 'active' || license?.status === 'trialing'),
    status: license?.status ?? null,
    subscriptionId: license?.subscriptionId ?? null,
  });
}
