'use client';

import { AccountInfo } from '@/components/account/account-info';
import { TeamSettings } from '@/components/account/team-settings';
import { BillingSettings } from '@/components/account/bill-settings';
import { NotificationSettings } from '@/components/account/notification-settings';
import { StoreCredentials } from '@/components/account/store-credentials';
import { LlmSettings } from '@/components/account/llm-settings';
import { PublishApprovalQueue } from '@/components/account/publish-approval-queue';
import { AutoReplyRules } from '@/components/aso/auto-reply-rules';
import { AuditLog } from '@/components/account/audit-log';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { DeleteAccount } from '@/components/account/delete-account';
import { OPEN_SOURCE_MODE } from '@/lib/config';
import { useTranslations } from 'next-intl';

export default function AccountSettingsView() {
  const t = useTranslations('account');
  return (
    <div className="container max-w-2xl py-2 space-y-8 mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-2"
      >
        <h1 className="text-3xl font-bold">{t('account-settings')}</h1>
        <p className="text-muted-foreground">
          {t('account-settings-description')}
        </p>
      </motion.div>

      <div className="space-y-6">
        <AccountInfo />
        <TeamSettings />
        <PublishApprovalQueue />
        {!OPEN_SOURCE_MODE && <BillingSettings />}
        <StoreCredentials />
        <LlmSettings />
        <NotificationSettings />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card>
            <CardHeader />
            <CardContent>
              <AutoReplyRules />
            </CardContent>
          </Card>
        </motion.div>
        <AuditLog />
        <DeleteAccount />
      </div>
    </div>
  );
}
