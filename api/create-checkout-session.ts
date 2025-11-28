import Stripe from 'stripe';
import type { NextApiRequest, NextApiResponse } from 'next';
import { parseJsonBody, allowedPrices } from './utils.js';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const appUrl = process.env.APP_URL ?? process.env.APP_BASE_URL;

  // SERVER-SIDE ONLY — do NOT use VITE_
  const proPrice = process.env.STRIPE_PRICE_PRO;
  const cloudPrice = process.env.STRIPE_PRICE_CLOUD;

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
    apiVersion: process.env.STRIPE_API_VERSION as Stripe.StripeConfig['apiVersion'],
  });

  const isCloudSubscription = cloudPrice && priceId === cloudPrice;
  const isProOneTime = proPrice && priceId === proPrice;

  try {
    const session = await stripe.checkout.sessions.create(
      isCloudSubscription
        ? {
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${appUrl}/?checkout=cancel`,
            metadata: { deviceId },
            subscription_data: { metadata: { deviceId } },
          }
        : {
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${appUrl}/?checkout=cancel`,
            metadata: { deviceId },
          },
      { idempotencyKey: `checkout_${deviceId}_${priceId}` }
    );

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (error) {
    console.error('Failed to create Stripe Checkout session', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown Stripe error' });
  }
}
