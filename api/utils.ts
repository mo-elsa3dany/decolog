// api/utils.ts
import type { VercelRequest } from '@vercel/node';
import type { NextApiRequest } from 'next';

type RequestWithBody = Pick<NextApiRequest, 'body'> | Pick<VercelRequest, 'body'> | { body?: unknown };

export function allowedPrices() {
  const pro = process.env.STRIPE_PRICE_PRO?.trim();
  const cloud = process.env.STRIPE_PRICE_CLOUD?.trim();
  const list = [pro, cloud].filter((price): price is string => Boolean(price));

  return { pro, cloud, list };
}

// Parses JSON body safely
export async function parseJsonBody(req: RequestWithBody) {
  try {
    if (!req.body) return {};
    if (typeof req.body === 'object') return req.body as Record<string, unknown>;
    return JSON.parse(req.body);
  } catch (err) {
    console.error('JSON parse error', err);
    return {};
  }
}
