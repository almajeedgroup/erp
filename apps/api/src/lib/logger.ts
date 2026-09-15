import { pino, type Logger, type LoggerOptions } from 'pino';
import type { AppConfig } from '../config/env.js';

/**
 * Structured logging.
 *
 * Two rules, both enforced here rather than left to reviewers:
 *
 *  1. **JSON in production.** Pretty-printing is a development affordance; a
 *     log aggregator wants one object per line.
 *  2. **Secrets never reach the log.** The redaction list below is applied by
 *     pino before serialisation, so an `Authorization` header or a password
 *     field cannot be logged even by an incautious `req.log.info({ req })`.
 *     Redaction at the sink is the only version that actually holds — see
 *     docs/03-security/secure-coding.md.
 */

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'password',
  'newPassword',
  'currentPassword',
  '*.password',
  '*.passwordHash',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  '*.accessToken',
  '*.refreshToken',
  'apiKey',
  'nationalId',
  'bankAccount',
  '*.nationalId',
  '*.bankAccount',
];

export function createLogger(config: AppConfig): Logger {
  const options: LoggerOptions = {
    level: config.isTest ? 'silent' : config.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'almajeed-erp-api', env: config.env },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (!config.isProduction && !config.isTest) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname,service,env',
        },
      },
    });
  }

  return pino(options);
}

export type { Logger };
