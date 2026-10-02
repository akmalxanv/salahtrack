import { Home, TrendingUp, Trophy, Compass, User, LucideIcon } from 'lucide-react';

export interface NavItemConfig {
  key: 'home' | 'progress' | 'leaderboard' | 'qibla' | 'account';
  href: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItemConfig[] = [
  { key: 'home', href: '/', icon: Home },
  { key: 'progress', href: '/progress', icon: TrendingUp },
  { key: 'leaderboard', href: '/leaderboard', icon: Trophy },
  { key: 'qibla', href: '/qibla', icon: Compass },
  { key: 'account', href: '/account', icon: User },
];
