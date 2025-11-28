// api/utils.ts
import type { NextApiRequest } from 'next';

export function allowedPrices() {
  return {
    PRO: process.env.STRIPE_PRICE_PRO,
    CLOUD: process.env.STRIPE_PRICE_CLOUD,
  };
}

// Parses JSON body safely
export async function parseJsonBody(req: NextApiRequest) {
  try {
    if (!req.body) return {};
    if (typeof req.body === 'object') return req.body;
    return JSON.parse(req.body);
  } catch (err) {
    console.error("JSON parse error", err);
    return {};
  }
}
