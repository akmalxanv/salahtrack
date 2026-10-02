import { redirect } from 'next/navigation';

export default function StatsPage() {
  redirect('/progress?tab=overview');
}
