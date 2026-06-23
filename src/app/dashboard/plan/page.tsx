import { FaUserCircle } from 'react-icons/fa';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Plans from '@/components/plan/plans';
import UpgradePlan from '@/components/plan/upgrade-plan';
import { OPEN_SOURCE_MODE } from '@/lib/config';

export const metadata = {
  title: 'AppAgent Plans',
  description:
    'AppAgent is a tool that just works without expertise or time dedication. OSS alternative to AppTweak, AppTweak AI, and AppTweak, and Sensor Tower.',
};

export default function PlanPage() {
  // Open-source build has no paid plans; never show the upgrade page.
  if (OPEN_SOURCE_MODE) {
    redirect('/dashboard');
  }
  return (
    <div className="w-full min-h-screen bg-gradient-to-b from-white via-gray-50 to-gray-100">
      <div className="container max-w-6xl px-4 mx-auto">
        <div className="pt-4 flex justify-end">
          <Link
            href="/dashboard/account"
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <FaUserCircle className="w-5 h-5" />
            <span className="text-sm">Account</span>
          </Link>
        </div>
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)]">
          <Plans />
          <UpgradePlan />
        </div>
      </div>
    </div>
  );
}
