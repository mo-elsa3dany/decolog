// api/create-checkout-session.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { allowedPrices, parseJsonBody } from './utils.js';

const STRIPE_API_VERSION: Stripe.StripeConfig['apiVersion'] = '2023-10-16';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    const appUrl = process.env.APP_URL;
    const prices = allowedPrices();

    if (!secretKey || !appUrl) {
      console.error('Stripe checkout config missing STRIPE_SECRET_KEY or APP_URL');
      return res.status(500).json({ error: 'Stripe checkout not configured' });
    }

    if (!prices.pro || !prices.cloud) {
      return res.status(500).json({ error: 'Stripe price IDs missing in environment' });
    }

    const body = await parseJsonBody(req);
    const mode = typeof (body as Record<string, unknown>).mode === 'string'
      ? (body as Record<string, unknown>).mode
      : undefined;

    if (mode !== 'pro' && mode !== 'cloud') {
      return res.status(400).json({ error: 'Missing mode (pro or cloud)' });
    }

    const deviceId = typeof (body as Record<string, unknown>).deviceId === 'string'
      ? (body as Record<string, unknown>).deviceId
      : undefined;

    const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });

    const session = await stripe.checkout.sessions.create({
      mode: mode === 'pro' ? 'payment' : 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: mode === 'pro' ? prices.pro : prices.cloud,
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/?status=success&plan=${mode}`,
      cancel_url: `${appUrl}/?status=cancel`,
      metadata: deviceId ? { deviceId } : undefined,
      subscription_data:
        mode === 'cloud' && deviceId ? { metadata: { deviceId } } : undefined,
    });

    if (!session.url || !session.id) {
      return res.status(500).json({ error: 'Stripe did not return a checkout URL' });
    }

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('CHECKOUT ERROR:', err);
    const message = err instanceof Error ? err.message : 'Server error during checkout';
    return res.status(500).json({ error: message });
  }
}
