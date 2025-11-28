import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';

function allowedPrices(): string[] {
  return [
    process.env.STRIPE_PRICE_MONTHLY,
    process.env.STRIPE_PRICE_YEARLY,
    process.env.STRIPE_PRICE_PRO,
    process.env.STRIPE_PRICE_CLOUD,
    process.env.VITE_STRIPE_PRICE_PRO,
    process.env.VITE_STRIPE_PRICE_CLOUD,
  ].filter((id): id is string => Boolean(id));
}

function parseJsonBody(req: VercelRequest): Record<string, unknown> {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof req.body === 'object' && req.body != null) {
    return req.body as Record<string, unknown>;
  }
  return {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const appUrl = process.env.APP_URL ?? process.env.APP_BASE_URL;
  const priceList = allowedPrices();

  if (!secretKey || !appUrl || !priceList.length) {
    console.warn('Stripe server config missing required keys or price IDs');
    return res.status(500).json({ error: 'Server Stripe configuration is missing.' });
  }

  const body = parseJsonBody(req);
  const priceId = typeof body.priceId === 'string' ? body.priceId : null;
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';

  if (!priceId || !priceList.includes(priceId)) {
    return res.status(400).json({ error: 'Invalid price' });
  }

  if (!deviceId) {
    return res.status(400).json({ error: 'Missing device id' });
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: '2024-06-20',
  });

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/?checkout=cancel`,
        metadata: { deviceId },
        subscription_data: {
          metadata: { deviceId },
        },
      },
      { idempotencyKey: `checkout_${deviceId}_${priceId}` },
    );

    if (!session.url || !session.id) {
      throw new Error('Stripe did not return a checkout URL.');
    }

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (error) {
    console.error('Failed to create Stripe Checkout session', error);
    const message = error instanceof Error ? error.message : 'Unknown Stripe error';
    return res.status(500).json({ error: message });
  }
}
