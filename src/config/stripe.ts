const missingEnvMessage = (key: string) => `Missing environment variable: ${key}`;

function requireEnv(value: string | undefined, key: string): string {
  if (value) return value;
  const message = missingEnvMessage(key);
  if (import.meta.env.DEV) {
    // Surface configuration issues early during local development.
    console.error(message);
  }
  throw new Error(message);
}

const resolvedAppBaseUrl = import.meta.env.APP_BASE_URL ?? import.meta.env.VITE_APP_BASE_URL;

if (import.meta.env.DEV && !resolvedAppBaseUrl) {
  console.warn('APP_BASE_URL is not set; falling back to window.location.origin in dev.');
}

const fallbackAppBaseUrl =
  resolvedAppBaseUrl ?? (typeof window !== 'undefined' ? window.location.origin : undefined);

export const stripePublishableKey = requireEnv(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY,
  'VITE_STRIPE_PUBLISHABLE_KEY',
);

export const stripePricePro = requireEnv(
  import.meta.env.VITE_STRIPE_PRICE_PRO,
  'VITE_STRIPE_PRICE_PRO',
);

export const stripePriceCloud = requireEnv(
  import.meta.env.VITE_STRIPE_PRICE_CLOUD,
  'VITE_STRIPE_PRICE_CLOUD',
);

export const appBaseUrl = requireEnv(fallbackAppBaseUrl, 'APP_BASE_URL');
