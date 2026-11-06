/** Base error for everything this SDK throws. Never throw raw strings. */
export class IgError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IgError';
  }
}

/** Thrown when the API answers with a non-success status. */
export class IgResponseError extends IgError {
  readonly statusCode: number;

  constructor(message: string, statusCode: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IgResponseError';
    this.statusCode = statusCode;
  }
}
