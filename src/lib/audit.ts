import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'publish'
  | 'import'
  | 'export'
  | 'schedule'
  | 'approve'
  | 'reject';

export type AuditEntity =
  | 'localization'
  | 'keyword'
  | 'app'
  | 'credential'
  | 'review_reply'
  | 'auto_reply_rule'
  | 'review_template'
  | 'app_version'
  | 'team_member'
  | 'llm_config';

export async function logAudit({
  teamId,
  userId,
  userEmail,
  action,
  entity,
  entityId,
  appId,
  meta,
}: {
  teamId: string;
  userId?: string;
  userEmail?: string;
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string;
  appId?: string;
  meta?: Record<string, unknown> | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        teamId,
        userId,
        userEmail,
        action,
        entity,
        entityId,
        appId,
        meta: meta as Prisma.InputJsonValue | undefined,
      },
    });
  } catch {
    // Audit logging is best-effort — never block the main operation
  }
}
