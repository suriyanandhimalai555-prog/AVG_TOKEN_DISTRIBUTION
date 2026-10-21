/**
 * Typed HTTP errors raised by the managed-wallet services and routes.
 * The error translator (middleware/notMigrated.ts) turns them into
 * `{ error, code }` responses; anything else becomes a generic 500.
 */
export class ManagedApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ManagedApiError";
  }
}

export function badRequest(code: string, message: string): ManagedApiError {
  return new ManagedApiError(400, code, message);
}

export function validation(message: string): ManagedApiError {
  return new ManagedApiError(400, "VALIDATION", message);
}

export function notFound(code: string, message: string): ManagedApiError {
  return new ManagedApiError(404, code, message);
}

export function conflict(code: string, message: string): ManagedApiError {
  return new ManagedApiError(409, code, message);
}
