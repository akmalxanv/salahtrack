import { redirect } from 'next/navigation';

export default function SettingsPage() {
  redirect('/account?tab=preferences');
}
