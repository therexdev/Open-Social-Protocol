/**
 * Tiny schema validators for message payloads. Every incoming message is validated against a
 * strict schema before the service worker does any privileged work; unknown keys are rejected.
 */
export class ValidationError extends Error {
  override name = "ValidationError";
}

export type Validator<T> = (value: unknown, path: string) => T;

function fail(path: string, expected: string): never {
  throw new ValidationError(`${path}: ${expected}`);
}

export function str(options: { max?: number; min?: number; pattern?: RegExp } = {}): Validator<string> {
  return (value, path) => {
    if (typeof value !== "string") fail(path, "expected a string");
    if (options.min !== undefined && value.length < options.min) fail(path, `expected at least ${options.min} characters`);
    if (options.max !== undefined && value.length > options.max) fail(path, `expected at most ${options.max} characters`);
    if (options.pattern && !options.pattern.test(value)) fail(path, "has an invalid format");
    return value;
  };
}

export function bool(): Validator<boolean> {
  return (value, path) => (typeof value === "boolean" ? value : fail(path, "expected a boolean"));
}

export function num(options: { min?: number; max?: number; int?: boolean } = {}): Validator<number> {
  return (value, path) => {
    if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "expected a number");
    if (options.int && !Number.isInteger(value)) fail(path, "expected an integer");
    if (options.min !== undefined && value < options.min) fail(path, `expected >= ${options.min}`);
    if (options.max !== undefined && value > options.max) fail(path, `expected <= ${options.max}`);
    return value;
  };
}

export function oneOf<const T extends readonly (string | number)[]>(values: T): Validator<T[number]> {
  return (value, path) => ((values as readonly unknown[]).includes(value) ? (value as T[number]) : fail(path, `expected one of ${values.join(", ")}`));
}

export function optional<T>(inner: Validator<T>): Validator<T | undefined> {
  return (value, path) => (value === undefined ? undefined : inner(value, path));
}

export function list<T>(inner: Validator<T>, options: { max?: number } = {}): Validator<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) fail(path, "expected an array");
    if (options.max !== undefined && value.length > options.max) fail(path, `expected at most ${options.max} items`);
    return value.map((item, i) => inner(item, `${path}[${i}]`));
  };
}

export function hex(bytes?: number): Validator<string> {
  return (value, path) => {
    if (typeof value !== "string" || !/^[0-9a-f]*$/i.test(value) || value.length % 2 !== 0) fail(path, "expected hex");
    if (bytes !== undefined && value.length !== bytes * 2) fail(path, `expected ${bytes} bytes of hex`);
    return value.toLowerCase();
  };
}

export function httpUrl(): Validator<string> {
  return (value, path) => {
    if (typeof value !== "string" || value.length > 2048) fail(path, "expected a URL");
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return fail(path, "expected a URL");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") fail(path, "expected an http(s) URL");
    return value;
  };
}

type Shape = Record<string, Validator<unknown>>;
type Infer<S extends Shape> = { [K in keyof S]: S[K] extends Validator<infer T> ? T : never };

/** An object with exactly the given keys (unknown keys are rejected). */
export function obj<S extends Shape>(shape: S): Validator<Infer<S>> {
  return (value, path) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "expected an object");
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) if (!(key in shape)) fail(`${path}.${key}`, "unknown key");
    const out: Record<string, unknown> = {};
    for (const [key, validator] of Object.entries(shape)) {
      const v = validator(record[key], `${path}.${key}`);
      if (v !== undefined) out[key] = v;
    }
    return out as Infer<S>;
  };
}

export const empty: Validator<Record<string, never>> = (value, path) => {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length > 0) fail(path, "expected no payload");
  return {};
};
