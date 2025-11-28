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

  // PRO = one-time
  const proPrice = process.env.VITE_STRIPE_PRICE_PRO;

  // CLOUD = subscription
  const cloudPrice = process.env.VITE_STRIPE_PRICE_CLOUD;

  const priceList = allowedPrices(); // must include both

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

  // Decide checkout mode
  const isCloudSubscription = cloudPrice && priceId === cloudPrice;
  const isProOneTime = proPrice && priceId === proPrice;

  if (!isCloudSubscription && !isProOneTime) {
    console.error('Price does not match PRO or CLOUD');
    return res.status(400).json({ error: 'Unsupported price ID' });
  }

  try {
    const session = await stripe.checkout.sessions.create(
      isCloudSubscription
        ? {
            // CLOUD subscription
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
          }
        : {
            // PRO one-time purchase
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: [
              {
                price: priceId,
                quantity: 1,
              },
            ],
            success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${appUrl}/?checkout=cancel`,
            metadata: { deviceId },
          },
      {
        idempotencyKey: `checkout_${deviceId}_${priceId}`,
      },
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
