#!/usr/bin/env node
/**
 * Bootstrap the first admin account for a self-hosted / desktop install.
 *
 * Usage:
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret ADMIN_NAME="You" \
 *     node scripts/create-admin.mjs
 *   # or: yarn admin:create
 *
 * Idempotent: re-running updates the password and ensures the user owns an
 * ADMIN team. The user can then sign in at /login with the password form
 * (the Credentials provider is enabled in open-source mode).
 */
import { readFileSync } from 'node:fs';
import { scryptSync, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

// Minimal .env loader so the script works with a plain `node` invocation
// (Prisma only auto-loads .env via its CLI, not at runtime).
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

// Keep this hashing format in sync with src/lib/password.ts.
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

async function main() {
  loadDotEnv();

  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const name = (process.env.ADMIN_NAME || '').trim() || null;

  if (!email || !password) {
    console.error(
      'Missing ADMIN_EMAIL and/or ADMIN_PASSWORD. Set them and re-run:\n' +
        '  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret yarn admin:create'
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = hashPassword(password);
    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash, ...(name ? { name } : {}) },
      create: {
        email,
        name,
        emailVerified: new Date(),
        locale: 'en',
        passwordHash,
      },
    });

    const teamCount = await prisma.userTeam.count({
      where: { userId: user.id },
    });
    if (teamCount === 0) {
      const teamName = user.name ? `${user.name}'s Team` : 'Personal Team';
      await prisma.team.create({
        data: {
          name: teamName,
          users: { create: { userId: user.id, role: 'ADMIN' } },
        },
      });
      console.log(`Created team "${teamName}" with ${email} as ADMIN.`);
    }

    console.log(`✓ Admin ready: ${email}`);
    console.log('  Sign in at /login using the password form.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
