import { describe, expect, it } from 'vitest';
import {
  AppError,
  conflict,
  dependencyFailed,
  forbidden,
  internalError,
  notFound,
  validationFailed,
} from './errors.js';

describe('errors', () => {
  it('maps codes to the right HTTP status', () => {
    expect(forbidden().status).toBe(403);
    expect(notFound('Client').status).toBe(404);
    expect(conflict('duplicate').status).toBe(409);
    expect(validationFailed([]).status).toBe(422);
    expect(internalError().status).toBe(500);
    expect(dependencyFailed('anthropic').status).toBe(502);
  });

  it('separates expected failures from bugs', () => {
    expect(forbidden().expected).toBe(true);
    expect(internalError().expected).toBe(false);
    expect(dependencyFailed('s3').expected).toBe(false);
  });

  it('serializes only client-safe fields', () => {
    const error = notFound('Invoice', 'inv_123');
    const body = error.toBody('req_abc');
    expect(body).toEqual({
      error: { code: 'not_found', message: 'Invoice not found', requestId: 'req_abc' },
    });
    expect(JSON.stringify(body)).not.toContain('inv_123');
    expect(error.details).toEqual({ id: 'inv_123' });
  });

  it('carries field issues through to the body', () => {
    const body = validationFailed([{ path: 'email', message: 'must be a valid email address' }]);
    expect(body.toBody().error.issues).toEqual([
      { path: 'email', message: 'must be a valid email address' },
    ]);
  });

  it('preserves the cause chain for logging', () => {
    const root = new Error('ECONNREFUSED');
    const wrapped = dependencyFailed('postgres', root);
    expect(wrapped.cause).toBe(root);
  });

  it('is detectable across module instances via the type guard', () => {
    expect(AppError.is(forbidden())).toBe(true);
    expect(AppError.is(new Error('plain'))).toBe(false);
    expect(AppError.is(null)).toBe(false);
  });
});
