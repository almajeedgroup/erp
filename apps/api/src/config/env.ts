import { z } from 'zod';

/**
 * Configuration.
 *
 * Everything the process needs is read here, once, at boot, and validated. A
 * missing `JWT_SECRET` should stop the container from starting, not surface as
 * a 500 at 3am when the first person tries to log in — so the schema is strict
 * and `loadConfig` throws with every problem listed at once.
 *
 * Nothing else in the codebase reads `process.env`. That is what makes the
 * server constructible in a test with an explicit config object.
 */

const bool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const port = z.coerce.number().int().min(1).max(65_535);
const seconds = z.coerce.number().int().positive();

/**
 * Secrets carry a floor of 32 characters and, outside development, an explicit
 * rejection of the placeholder shipped in `.env.example` — a deployment that
 * boots with the sample key is worse than one that refuses to boot.
 */
const secret = z.string().min(32, 'must be at least 32 characters');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: port.default(4000),
    WEB_ORIGIN: z.string().default('http://localhost:3000'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_SSL: bool.default(false),

    JWT_SECRET: secret,
    JWT_ISSUER: z.string().default('almajeed-erp'),
    JWT_AUDIENCE: z.string().default('almajeed-erp-api'),
    ACCESS_TOKEN_TTL: seconds.default(900),
    REFRESH_TOKEN_TTL: seconds.default(2_592_000),
    PASSWORD_PEPPER: secret,

    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    RATE_LIMIT_WINDOW: z.coerce.number().int().min(1_000).default(60_000),
    /** Login, refresh and password change: the credential-stuffing surface. */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    AUTH_RATE_LIMIT_WINDOW: z.coerce.number().int().min(1_000).default(900_000),
    /** Registration, which creates a tenant and so is worth limiting harder. */
    REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
    REGISTER_RATE_LIMIT_WINDOW: z.coerce.number().int().min(1_000).default(3_600_000),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('./var/storage'),
    STORAGE_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1).default(26_214_400),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    AI_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL: z.string().default('claude-sonnet-5'),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(64_000).default(2_048),
    AI_EMBEDDING_DIMENSIONS: z.coerce.number().int().min(64).max(4_096).default(1_536),
    AI_MAX_AGENT_STEPS: z.coerce.number().int().min(1).max(32).default(8),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      for (const key of ['JWT_SECRET', 'PASSWORD_PEPPER'] as const) {
        if (env[key].startsWith('CHANGE_ME')) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} still holds the .env.example placeholder; generate one with "openssl rand -base64 48"`,
          });
        }
      }
      if (!env.DATABASE_SSL) {
        ctx.addIssue({
          code: 'custom',
          path: ['DATABASE_SSL'],
          message: 'DATABASE_SSL must be true in production',
        });
      }
    }
    if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET is required when STORAGE_DRIVER=s3',
      });
    }
    if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message: 'ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  isTest: boolean;
  logLevel: Env['LOG_LEVEL'];
  host: string;
  port: number;
  webOrigin: string;
  database: { url: string; poolMax: number; ssl: boolean };
  auth: {
    jwtSecret: string;
    issuer: string;
    audience: string;
    accessTokenTtl: number;
    refreshTokenTtl: number;
    passwordPepper: string;
  };
  rateLimit: {
    max: number;
    windowMs: number;
    authMax: number;
    authWindowMs: number;
    registerMax: number;
    registerWindowMs: number;
  };
  storage: {
    driver: 'local' | 's3';
    localPath: string;
    maxUploadBytes: number;
    s3?: { bucket: string; region?: string; endpoint?: string };
  };
  ai: {
    provider: 'mock' | 'anthropic';
    apiKey?: string;
    model: string;
    maxOutputTokens: number;
    embeddingDimensions: number;
    maxAgentSteps: number;
  };
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return toConfig(parsed.data);
}

export function toConfig(env: Env): AppConfig {
  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    logLevel: env.LOG_LEVEL,
    host: env.API_HOST,
    port: env.API_PORT,
    webOrigin: env.WEB_ORIGIN,
    database: {
      url: env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
      ssl: env.DATABASE_SSL,
    },
    auth: {
      jwtSecret: env.JWT_SECRET,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      accessTokenTtl: env.ACCESS_TOKEN_TTL,
      refreshTokenTtl: env.REFRESH_TOKEN_TTL,
      passwordPepper: env.PASSWORD_PEPPER,
    },
    rateLimit: {
      max: env.RATE_LIMIT_MAX,
      windowMs: env.RATE_LIMIT_WINDOW,
      authMax: env.AUTH_RATE_LIMIT_MAX,
      authWindowMs: env.AUTH_RATE_LIMIT_WINDOW,
      registerMax: env.REGISTER_RATE_LIMIT_MAX,
      registerWindowMs: env.REGISTER_RATE_LIMIT_WINDOW,
    },
    storage: {
      driver: env.STORAGE_DRIVER,
      localPath: env.STORAGE_LOCAL_PATH,
      maxUploadBytes: env.STORAGE_MAX_UPLOAD_BYTES,
      ...(env.S3_BUCKET
        ? { s3: { bucket: env.S3_BUCKET, region: env.S3_REGION, endpoint: env.S3_ENDPOINT } }
        : {}),
    },
    ai: {
      provider: env.AI_PROVIDER,
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.AI_MODEL,
      maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
      embeddingDimensions: env.AI_EMBEDDING_DIMENSIONS,
      maxAgentSteps: env.AI_MAX_AGENT_STEPS,
    },
  };
}
