/**
 * Deterministic 31-bit seed derived from stable identifiers. Passing the same
 * element or scene back to the image model keeps regenerations more consistent.
 */
export function stableSeed(...parts: string[]): number {
  let hash = 2166136261;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 0x1f;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647;
}