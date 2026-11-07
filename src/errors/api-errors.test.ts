import { describe, it, expect } from 'vitest';
import { IgError } from './ig-error';
import { IgApiError, LoginRequiredError, ClientJsonError } from './api-errors';

describe('api errors', () => {
  it('names each class from its constructor', () => {
    expect(new LoginRequiredError('x', 403).name).toBe('LoginRequiredError');
    expect(new IgApiError('x', 400).name).toBe('IgApiError');
    expect(new ClientJsonError('x').name).toBe('ClientJsonError');
  });

  it('chains instanceof and defaults the payload', () => {
    const error = new LoginRequiredError('x', 403);
    expect(error).toBeInstanceOf(IgApiError);
    expect(error).toBeInstanceOf(IgError);
    expect(error.payload).toEqual({});
    expect(error.statusCode).toBe(403);
  });
});
