/**
 * Provider-agnostic (de)serialization for Competitor.guessedKeywords.
 *
 * Postgres stores this column as a native `String[]`; SQLite has no array type,
 * so the generated SQLite schema stores it as a JSON-encoded `String`. These
 * helpers let the same code read/write the field under either provider.
 */

/** Read the field as an array regardless of provider. */
export function parseGuessedKeywords(
  value: string[] | string | null | undefined
): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Produce the value to write into the column. Under SQLite it is JSON-encoded to
 * a string; under Postgres the array is passed through. The cast keeps the
 * Postgres client's `String[]` type happy while emitting a string at runtime.
 */
export function serializeGuessedKeywords(keywords: string[]): string[] {
  if (process.env.DATABASE_PROVIDER === 'sqlite') {
    return JSON.stringify(keywords) as unknown as string[];
  }
  return keywords;
}
