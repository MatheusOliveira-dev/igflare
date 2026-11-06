import { describe, it, expect } from 'vitest';
import { IgError, IgResponseError } from './ig-error';

describe('IgError', () => {
  it('carries its name and message', () => {
    const error = new IgError('boom');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('IgError');
    expect(error.message).toBe('boom');
  });

  it('keeps the cause when given one', () => {
    const cause = new Error('root');
    const error = new IgError('wrapped', { cause });
    expect(error.cause).toBe(cause);
  });
});

describe('IgResponseError', () => {
  it('is an IgError and exposes the status code', () => {
    const error = new IgResponseError('bad request', 400);
    expect(error).toBeInstanceOf(IgError);
    expect(error.name).toBe('IgResponseError');
    expect(error.statusCode).toBe(400);
  });
});
