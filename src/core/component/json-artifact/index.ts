/**
 * Provides reusable json artifact primitives for PixieCore.
 */

/**
 * Defines the supported json artifact primitive values.
 */
export type JsonArtifactPrimitive = string | number | boolean | null;
/**
 * Defines the supported json artifact value values.
 */
export type JsonArtifactValue =
  | JsonArtifactPrimitive
  | JsonArtifactValue[]
  | { [key: string]: JsonArtifactValue };
/**
 * Defines the supported json artifact object values.
 */
export type JsonArtifactObject = { [key: string]: JsonArtifactValue };
/**
 * Defines the supported json artifact error factory values.
 */
export type JsonArtifactErrorFactory = (message: string) => Error;

/**
 * Clones and deeply freezes a JSON value.
 */
export function cloneFrozenJsonValue(
  value: unknown,
  path: string,
  createError: JsonArtifactErrorFactory = message => new TypeError(message),
): JsonArtifactValue {
  return cloneJsonValue(value, path, new WeakSet(), createError);
}

/**
 * Clones and deeply freezes a JSON object.
 */
export function cloneFrozenJsonObject(
  value: unknown,
  path: string,
  createError: JsonArtifactErrorFactory = message => new TypeError(message),
): JsonArtifactObject {
  const clone = cloneFrozenJsonValue(value, path, createError);
  if (clone === null || Array.isArray(clone) || typeof clone !== 'object') {
    throw createError(`${path} must be a JSON object`);
  }
  return clone;
}

/**
 * Serializes JSON with stable key ordering for hashing and signatures.
 */
export function canonicalJson(value: unknown): string {
  return serializeJson(value, '$', new WeakSet());
}

function cloneJsonValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
  createError: JsonArtifactErrorFactory,
): JsonArtifactValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw createError(`${path} must not contain a non-finite number`);
  }
  if (typeof value !== 'object') throw createError(`${path} must contain only JSON values`);
  if (ancestors.has(value)) throw createError(`${path} must not contain a cycle`);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result: JsonArtifactValue[] = Array.from({ length: value.length }, (_, index) => {
        if (!(index in value)) throw createError(`${path}[${index}] must not be sparse`);
        return cloneJsonValue(value[index], `${path}[${index}]`, ancestors, createError);
      });
      Object.freeze(result);
      return result;
    }

    assertPlainObject(value, path, createError);
    const result: JsonArtifactObject = {};
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(result, key, {
        configurable: false,
        enumerable: true,
        value: cloneJsonValue(item, `${path}.${key}`, ancestors, createError),
        writable: false,
      });
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

function serializeJson(value: unknown, path: string, ancestors: WeakSet<object>): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError(`${path} contains a non-JSON value`);
  if (ancestors.has(value)) throw new TypeError(`${path} contains a cycle`);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items = Array.from({ length: value.length }, (_, index) => {
        if (!(index in value)) throw new TypeError(`${path}[${index}] is sparse`);
        return serializeJson(value[index], `${path}[${index}]`, ancestors);
      });
      return `[${items.join(',')}]`;
    }

    assertPlainObject(value, path, message => new TypeError(message));
    const entries = Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${serializeJson(item, `${path}.${key}`, ancestors)}`);
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function assertPlainObject(
  value: object,
  path: string,
  createError: JsonArtifactErrorFactory,
): void {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw createError(`${path} must contain only plain JSON objects`);
  }
  if (Reflect.ownKeys(value).some(key => typeof key === 'symbol')) {
    throw createError(`${path} must not contain symbol properties`);
  }
}
