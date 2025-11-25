import Stripe from 'stripe';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const appUrl = process.env.VITE_APP_URL;

  if (!secretKey || !appUrl) {
    console.error('Stripe config missing: STRIPE_SECRET_KEY or VITE_APP_URL is not set.');
    return res.status(500).json({ error: 'Server Stripe configuration is missing.' });
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: '2023-10-16',
  });

  const { priceId } = req.body as { priceId?: string };

  if (!priceId) {
    return res.status(400).json({ error: 'Missing priceId' });
  }

  try {
    const price = await stripe.prices.retrieve(priceId);
    const mode: Stripe.Checkout.SessionCreateParams.Mode =
      price.recurring != null ? 'subscription' : 'payment';

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/success`,
      cancel_url: `${appUrl}/cancel`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
