import { PrismaClient } from '@prisma/client';
import { sqliteJsonExtension } from '@/lib/prisma-sqlite-json';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient();
  // SQLite stores Json columns as strings; transparently (de)serialize them.
  if (process.env.DATABASE_PROVIDER === 'sqlite') {
    return client.$extends(sqliteJsonExtension) as unknown as PrismaClient;
  }
  return client;
}

const prisma = global.prisma || createPrismaClient();

if (process.env.NODE_ENV === 'development') global.prisma = prisma;

export default prisma;
