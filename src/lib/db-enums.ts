/**
 * Database enum constants, decoupled from the generated Prisma client.
 *
 * Postgres stores these as native enums; SQLite (see scripts/gen-sqlite-schema.mjs)
 * stores them as plain strings. Importing the enum *values* from here instead of
 * from `@prisma/client` keeps the code compiling and running under both providers,
 * since the SQLite-generated client has no enum exports. The string values match
 * the enum members in prisma/schema.prisma exactly, so they are assignable to the
 * Postgres client's enum types too.
 */

export const Role = {
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  MEMBER: 'MEMBER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const EmailType = {
  FIRST_TRIAL_END_REMINDER_EMAIL: 'FIRST_TRIAL_END_REMINDER_EMAIL',
  FINAL_TRIAL_END_REMINDER_EMAIL: 'FINAL_TRIAL_END_REMINDER_EMAIL',
} as const;
export type EmailType = (typeof EmailType)[keyof typeof EmailType];

export const Store = {
  APPSTORE: 'APPSTORE',
  GOOGLEPLAY: 'GOOGLEPLAY',
} as const;
export type Store = (typeof Store)[keyof typeof Store];

export const Platform = {
  IOS: 'IOS',
  ANDROID: 'ANDROID',
  MACOS: 'MACOS',
  TVOS: 'TVOS',
} as const;
export type Platform = (typeof Platform)[keyof typeof Platform];
