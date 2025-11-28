function readEnv(value: string | undefined, key: string): string | undefined {
  if (value) return value;
  if (import.meta.env.DEV) {
    console.warn(`Missing environment variable: ${key}`);
  }
  return undefined;
}

const resolvedAppBaseUrl = import.meta.env.APP_BASE_URL ?? import.meta.env.VITE_APP_BASE_URL;

if (import.meta.env.DEV && !resolvedAppBaseUrl) {
  console.warn('APP_BASE_URL is not set; falling back to window.location.origin in dev.');
}

const fallbackAppBaseUrl =
  resolvedAppBaseUrl ?? (typeof window !== 'undefined' ? window.location.origin : undefined);

export const stripePublishableKey = readEnv(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY,
  'VITE_STRIPE_PUBLISHABLE_KEY',
);

export const stripePricePro = readEnv(import.meta.env.VITE_STRIPE_PRICE_PRO, 'VITE_STRIPE_PRICE_PRO');

export const stripePriceCloud = readEnv(
  import.meta.env.VITE_STRIPE_PRICE_CLOUD,
  'VITE_STRIPE_PRICE_CLOUD',
);

export const appBaseUrl = readEnv(fallbackAppBaseUrl, 'APP_BASE_URL');
