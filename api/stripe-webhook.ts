import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { upsertLicense } from './licenseStore.js';

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  if (typeof req.body === 'string') {
    return Buffer.from(req.body);
  }
  if (req.body && Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret) {
    console.error('Stripe webhook config missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
    return res.status(500).json({ error: 'Stripe webhook not configured' });
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: process.env.STRIPE_API_VERSION as Stripe.StripeConfig['apiVersion'],
  });
  const signature = req.headers['stripe-signature'];

  if (!signature || Array.isArray(signature)) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event: Stripe.Event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown webhook error';
    console.error('Stripe webhook verification failed', message);
    return res.status(400).send(`Webhook Error: ${message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const deviceId = session.metadata?.deviceId;
      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      if (deviceId && subscriptionId) {
        await upsertLicense({ deviceId, subscriptionId, status: 'active' });
        console.log(
          `Stripe webhook: activate license for device ${deviceId} with subscription ${subscriptionId}`,
        );
      } else {
        console.log('Stripe webhook: checkout.session.completed missing device or subscription', {
          deviceId,
          subscriptionId,
        });
      }
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const deviceId = subscription.metadata?.deviceId;
      const status = subscription.status;
      if (deviceId) {
        await upsertLicense({
          deviceId,
          subscriptionId: subscription.id,
          status,
        });
        console.log(
          `Stripe webhook: subscription ${event.type} for device ${deviceId} (status: ${status})`,
        );
      } else {
        console.log(`Stripe webhook: ${event.type} without device metadata`, {
          subscriptionId: subscription.id,
          status,
        });
      }
      break;
    }
    default: {
      console.log(`Stripe webhook: unhandled event ${event.type}`);
    }
  }

  return res.status(200).json({ received: true });
}
