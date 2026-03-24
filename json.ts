export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOwn<K extends PropertyKey>(
  value: object,
  key: K,
): value is Record<K, unknown> {
  return Object.hasOwn(value, key);
}
