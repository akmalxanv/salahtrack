import { redirect } from 'next/navigation';

export default function AnalyticsPage() {
  redirect('/progress?tab=analytics');
}
