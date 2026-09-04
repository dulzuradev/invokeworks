import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LIVEAUTH_PUBLIC_KEY: z.string().min(1).optional(),
  LIVEAUTH_API_URL: z.url().default('https://api.liveauth.app'),
  LIVEAUTH_BYPASS_FOR_TESTS: z.enum(['true', 'false']).default('false'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(env: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.LIVEAUTH_PUBLIC_KEY) {
    throw new Error('LIVEAUTH_PUBLIC_KEY is required in production');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.LIVEAUTH_BYPASS_FOR_TESTS === 'true') {
    throw new Error('LIVEAUTH_BYPASS_FOR_TESTS cannot be enabled in production');
  }
  return parsed.data;
}

export function correlationId(value?: string | null): string {
  return value && /^[a-zA-Z0-9._-]{1,128}$/.test(value) ? value : crypto.randomUUID();
}
