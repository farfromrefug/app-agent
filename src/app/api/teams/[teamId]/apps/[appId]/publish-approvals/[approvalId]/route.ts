import { validateTeamAccess } from '@/lib/auth';
import {
  handleAppError,
  AppNotFoundError,
  InvalidParamsError,
} from '@/types/errors';
import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { Role } from '@/lib/db-enums';
import { createNotification } from '@/lib/notifications';

// PATCH /api/teams/[teamId]/apps/[appId]/publish-approvals/[approvalId]
// Body: { action: "approved" | "rejected", reviewNote?: string }
// Requires ADMIN or MANAGER role
export async function PATCH(
  request: Request,
  { params }: { params: { teamId: string; appId: string; approvalId: string } }
) {
  try {
    const { userId, teamId } = await validateTeamAccess(request);
    const { appId, approvalId } = params;
    const { action, reviewNote } = await request.json();

    if (action !== 'approved' && action !== 'rejected') {
      throw new InvalidParamsError('action must be "approved" or "rejected"');
    }

    // Verify the reviewer has ADMIN or MANAGER role
    const membership = await prisma.userTeam.findUnique({
      where: { userId_teamId: { userId, teamId } },
      select: { role: true },
    });
    if (
      !membership ||
      (membership.role !== Role.ADMIN && membership.role !== Role.MANAGER)
    ) {
      return NextResponse.json(
        { error: 'Only admins and managers can review approval requests' },
        { status: 403 }
      );
    }

    const app = await prisma.app.findFirst({
      where: { id: appId, teamId },
      select: { id: true, title: true },
    });
    if (!app) throw new AppNotFoundError(`App ${appId} not found`);

    const approval = await prisma.publishApproval.findFirst({
      where: { id: approvalId, teamId, appId },
    });
    if (!approval) {
      return NextResponse.json(
        { error: 'Approval not found' },
        { status: 404 }
      );
    }
    if (approval.status !== 'pending') {
      return NextResponse.json(
        { error: 'Approval request is no longer pending' },
        { status: 409 }
      );
    }

    const updated = await prisma.publishApproval.update({
      where: { id: approvalId },
      data: {
        status: action,
        reviewedBy: userId,
        reviewNote: reviewNote ?? null,
        reviewedAt: new Date(),
      },
    });

    // Notify the team about the decision
    const icon = action === 'approved' ? '✅' : '❌';
    createNotification({
      teamId,
      appId,
      type: action === 'approved' ? 'publish_approved' : 'publish_rejected',
      title: `${icon} Publish ${action} for ${app.title ?? appId}`,
      body: reviewNote ?? `Your publish request was ${action}.`,
    }).catch(console.error);

    return NextResponse.json(updated);
  } catch (error) {
    return handleAppError(error as Error);
  }
}
