import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';

type CheckoutMode = 'pro' | 'cloud';

const stripeConfig = {
  secretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET, // reserved for future webhook verification
  pricePro: process.env.VITE_STRIPE_PRICE_PRO ?? process.env.STRIPE_PRICE_PRO,
  priceCloud: process.env.VITE_STRIPE_PRICE_CLOUD ?? process.env.STRIPE_PRICE_CLOUD,
  appBaseUrl: process.env.APP_BASE_URL,
};

function validateConfig() {
  const missing: string[] = [];
  if (!stripeConfig.secretKey) missing.push('STRIPE_SECRET_KEY');
  if (!stripeConfig.pricePro) missing.push('VITE_STRIPE_PRICE_PRO');
  if (!stripeConfig.priceCloud) missing.push('VITE_STRIPE_PRICE_CLOUD');
  if (!stripeConfig.appBaseUrl) missing.push('APP_BASE_URL');

  if (missing.length) {
    console.error(`Stripe server config missing: ${missing.join(', ')}`);
  }

  if (process.env.NODE_ENV !== 'production' && !stripeConfig.webhookSecret) {
    console.warn('STRIPE_WEBHOOK_SECRET not set; webhook handling is disabled.');
  }

  return missing;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const missing = validateConfig();
  if (missing.length) {
    return res.status(500).json({ error: 'Server Stripe configuration is missing.' });
  }

  const stripe = new Stripe(stripeConfig.secretKey as string, {
    apiVersion: '2024-06-20',
  });

  let parsedBody: unknown = req.body ?? {};
  if (typeof req.body === 'string') {
    try {
      parsedBody = JSON.parse(req.body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }

  const mode = (parsedBody as { mode?: CheckoutMode }).mode;

  if (mode !== 'pro' && mode !== 'cloud') {
    return res.status(400).json({ error: 'Invalid checkout mode' });
  }

  const priceId = (mode === 'pro' ? stripeConfig.pricePro : stripeConfig.priceCloud) as string;
  const appBaseUrl = stripeConfig.appBaseUrl as string;
  const checkoutMode: Stripe.Checkout.SessionCreateParams.Mode =
    mode === 'pro' ? 'payment' : 'subscription';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: checkoutMode,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${appBaseUrl}/?checkout=success&mode=${mode}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appBaseUrl}/?checkout=cancel`,
      metadata: { license_mode: mode },
      subscription_data:
        mode === 'cloud'
          ? {
              metadata: { license_mode: mode },
            }
          : undefined,
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL.');
    }

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Failed to create Stripe Checkout session', error);
    const message = error instanceof Error ? error.message : 'Unknown Stripe error';
    return res.status(500).json({ error: message });
  }
}
