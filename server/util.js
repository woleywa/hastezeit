import crypto from 'node:crypto';

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** URL-safe random id without ambiguous characters (no 0/O, 1/l/I). */
export function randomId(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export const nowIso = () => new Date().toISOString();

/** Errors thrown by the domain layer; the HTTP layer maps `status` to the response code. */
export class AppError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg) => new AppError(400, msg, 'bad_request');
export const unauthorized = (msg = 'Bitte einloggen.') => new AppError(401, msg, 'unauthorized');
export const forbidden = (msg = 'Kein Zugriff.') => new AppError(403, msg, 'forbidden');
export const notFound = (msg = 'Nicht gefunden.') => new AppError(404, msg, 'not_found');
export const conflict = (msg) => new AppError(409, msg, 'conflict');

export function cleanString(value, max, { required = false, field = 'Feld' } = {}) {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${field} fehlt.`);
    return null;
  }
  if (typeof value !== 'string') throw badRequest(`${field} ist ungültig.`);
  const s = value.trim();
  if (!s) {
    if (required) throw badRequest(`${field} fehlt.`);
    return null;
  }
  if (s.length > max) throw badRequest(`${field} ist zu lang (max. ${max} Zeichen).`);
  return s;
}

export function parseIso(value, field) {
  if (typeof value !== 'string' || !value) throw badRequest(`${field} fehlt.`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} ist kein gültiges Datum.`);
  return d.toISOString();
}

export function jsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
