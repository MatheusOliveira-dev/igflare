import { ClientSchemaError } from '../errors/api-errors';

export interface ElementSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

/**
 * Validates each element of an array with a zod schema, returning the typed list.
 * A non-array value or an element that fails the schema throws a typed error that
 * names `what` (e.g. 'user', 'comment'), carrying the offending value.
 */
export function parseSchemaList<T>(values: unknown, schema: ElementSchema<T>, what: string): T[] {
  if (!Array.isArray(values)) {
    throw new ClientSchemaError(`response did not include a ${what} array`, values);
  }
  return values.map((candidate) => {
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      throw new ClientSchemaError(`a ${what} did not match its schema`, candidate, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  });
}
