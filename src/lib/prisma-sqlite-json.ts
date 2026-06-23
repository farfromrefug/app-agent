/**
 * SQLite has no native Json type, so the generated SQLite schema stores the
 * schema's Json columns as plain strings (see scripts/gen-sqlite-schema.mjs).
 * This Prisma Client extension makes that transparent: it JSON.stringifies the
 * affected fields on write and JSON.parses them on read, so application code can
 * keep treating them as structured values exactly like on Postgres.
 *
 * Applied only when DATABASE_PROVIDER=sqlite (see src/lib/prisma.ts).
 *
 * NOTE: this module must stay free of top-level side effects (no
 * `Prisma.defineExtension(...)` call, no import of the `Prisma` runtime value).
 * `prisma.ts` is sometimes reachable from the client bundle; a side-effectful
 * top-level call would force it to execute in the browser and throw. Exporting a
 * plain object keeps the module tree-shakeable out of client bundles.
 */

// Field names of the schema's Json columns. They are unique enough across models
// to be matched by name wherever they appear in write data or read results.
const JSON_FIELD_NAMES = new Set([
  'googleServiceAccountKey',
  'limits',
  'serviceAccountKey',
  'histogram',
  'screenshots',
  'meta',
  'bgGradient',
  'slides',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/** Recursively JSON.stringify Json-typed fields in write arguments (in place). */
function encodeWrites(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(encodeWrites);
    return;
  }
  if (!isPlainObject(node)) {
    return;
  }
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (JSON_FIELD_NAMES.has(key)) {
      if (value !== undefined && value !== null && typeof value !== 'string') {
        node[key] = JSON.stringify(value);
      }
    } else if (isPlainObject(value) || Array.isArray(value)) {
      // Descend into nested writes (create/update/upsert/createMany/etc.).
      encodeWrites(value);
    }
  }
}

/** Recursively JSON.parse Json-typed string fields in read results (in place). */
function decodeReads(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(decodeReads);
    return;
  }
  if (!isPlainObject(node)) {
    return;
  }
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (JSON_FIELD_NAMES.has(key) && typeof value === 'string') {
      try {
        node[key] = JSON.parse(value);
      } catch {
        // Leave malformed values untouched.
      }
    } else if (isPlainObject(value) || Array.isArray(value)) {
      decodeReads(value);
    }
  }
}

type AllOperationsArgs = {
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
};

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

// Plain extension object (no Prisma.defineExtension call — see note above).
// Passed to client.$extends() only on the server in src/lib/prisma.ts.
export const sqliteJsonExtension = {
  name: 'sqlite-json',
  query: {
    $allModels: {
      async $allOperations({ operation, args, query }: AllOperationsArgs) {
        let skipDuplicates = false;
        if (args && typeof args === 'object') {
          const a = args as Record<string, unknown>;
          encodeWrites(a.data);
          encodeWrites(a.create);
          encodeWrites(a.update);
          // SQLite's createMany has no `skipDuplicates`; strip it and emulate by
          // swallowing unique-constraint violations (covers idempotent re-runs).
          if (operation === 'createMany' && a.skipDuplicates) {
            skipDuplicates = true;
            delete a.skipDuplicates;
          }
        }
        try {
          const result = await query(args);
          decodeReads(result);
          return result;
        } catch (error) {
          if (skipDuplicates && isUniqueConstraintError(error)) {
            return { count: 0 };
          }
          throw error;
        }
      },
    },
  },
};
