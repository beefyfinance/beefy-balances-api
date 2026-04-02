export class FriendlyError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'FriendlyError';
    this.cause = cause;
  }
}
