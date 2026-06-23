#!/usr/bin/env node
/**
 * Generate a SQLite-compatible Prisma schema from the canonical Postgres schema.
 *
 * The Postgres schema (prisma/schema.prisma) stays the source of truth so that
 * merges from upstream remain clean. This script derives prisma/schema.sqlite.prisma
 * by applying the few transforms SQLite needs:
 *   - datasource provider postgresql -> sqlite
 *   - native enums -> String (enum blocks removed, enum-typed fields become String)
 *   - enum defaults quoted: @default(MEMBER) -> @default("MEMBER")
 *   - scalar arrays (String[]) -> nullable String (JSON-encoded at runtime)
 *   - Json -> String (SQLite has no Json type; src/lib/prisma-sqlite-json.ts
 *     transparently (de)serializes these fields at runtime)
 *   - @db.Text / @db.Date and other @db.* native hints stripped
 *
 * The generated file is git-ignored and rewritten on every `db:setup` run.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../prisma/schema.prisma', import.meta.url);
const OUT = new URL('../prisma/schema.sqlite.prisma', import.meta.url);

const ENUMS = ['Role', 'EmailType', 'Store', 'Platform'];

function transform(schema) {
  const lines = schema.split('\n');
  const out = [];
  let inEnum = false;

  for (const line of lines) {
    // Drop enum blocks entirely.
    if (/^\s*enum\s+\w+\s*\{/.test(line)) {
      inEnum = true;
      continue;
    }
    if (inEnum) {
      if (/^\s*\}/.test(line)) {
        inEnum = false;
      }
      continue;
    }

    let l = line;

    // Datasource provider.
    l = l.replace(/provider\s*=\s*"postgresql"/, 'provider = "sqlite"');

    // Enum-typed field -> String, preserving an optional `?` modifier.
    // Matches: "  <fieldName>   <Enum>" at the start of a field declaration.
    const enumField = new RegExp(
      `^(\\s*[A-Za-z_]\\w*\\s+)(${ENUMS.join('|')})(\\??)(\\s|$)`
    );
    l = l.replace(
      enumField,
      (_m, pre, _enum, opt, tail) => `${pre}String${opt}${tail}`
    );

    // Quote bare enum defaults: @default(MEMBER) -> @default("MEMBER").
    l = l.replace(/@default\(([A-Z_]+)\)/g, '@default("$1")');

    // Scalar string arrays -> nullable string (stored JSON-encoded).
    l = l.replace(/\bString\[\]/g, 'String?');

    // Json fields -> String (SQLite has no Json type). Preserve `?` modifier;
    // any @default("...") string literal remains a valid String default.
    l = l.replace(/^(\s*[A-Za-z_]\w*\s+)Json(\??)/, '$1String$2');

    // Strip Postgres-only native type hints.
    l = l.replace(/\s*@db\.\w+/g, '');

    // SQLite does not support named foreign keys (the `map:` arg on @relation).
    l = l.replace(/,\s*map:\s*"[^"]*"/g, '');

    out.push(l);
  }

  return out.join('\n');
}

const schema = readFileSync(SRC, 'utf8');
const result = transform(schema);
writeFileSync(OUT, result);
console.log('Generated prisma/schema.sqlite.prisma');
