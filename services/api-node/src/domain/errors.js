/**
 * Domain errors. The inbound HTTP adapter maps each `kind` to a status code; nothing in the domain
 * knows about HTTP.
 */
export class DomainError extends Error {
  /**
   * @param {'INVALID_INPUT'|'NOT_FOUND'|'UNAVAILABLE'|'UPSTREAM'} kind
   * @param {string} message
   * @param {object} [details]
   */
  constructor(kind, message, details = undefined) {
    super(message);
    this.name = 'DomainError';
    this.kind = kind;
    if (details !== undefined) this.details = details;
  }
}

export const invalid = (message, details) => new DomainError('INVALID_INPUT', message, details);
export const notFound = (message, details) => new DomainError('NOT_FOUND', message, details);
export const unavailable = (message, details) => new DomainError('UNAVAILABLE', message, details);
export const upstream = (message, details) => new DomainError('UPSTREAM', message, details);
