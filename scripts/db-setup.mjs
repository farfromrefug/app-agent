#!/usr/bin/env node
/**
 * Database setup dispatcher. Generates the Prisma client and applies the schema
 * for the configured provider.
 *
 *   DATABASE_PROVIDER=postgresql (default) -> prisma generate + migrate deploy
 *   DATABASE_PROVIDER=sqlite               -> generate the SQLite schema, then
 *                                             prisma generate + db push against it
 *
 * Set DATABASE_PROVIDER and a matching DATABASE_URL in .env, e.g. for SQLite:
 *   DATABASE_PROVIDER=sqlite
 *   DATABASE_URL=file:./dev.db
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Minimal .env loader so DATABASE_PROVIDER is visible before invoking Prisma.
function loadDotEnv() {
  try {
    const content = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (!match) continue;
      const key = match[1];
      if (process.env[key] !== undefined) continue;
      let value = (match[2] ?? '').trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // No .env file — rely on the ambient environment.
  }
}

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

loadDotEnv();

const provider = (process.env.DATABASE_PROVIDER || 'postgresql').toLowerCase();

if (provider === 'sqlite') {
  const schema = 'prisma/schema.sqlite.prisma';
  run('node scripts/gen-sqlite-schema.mjs');
  run(`npx prisma generate --schema ${schema}`);
  run(`npx prisma db push --schema ${schema}`);
} else {
  run('npx prisma generate');
  run('npx prisma migrate deploy');
}

console.log(`Database setup complete (provider: ${provider}).`);
