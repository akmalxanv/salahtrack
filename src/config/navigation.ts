import { Home, Calendar, Calculator, BarChart3, User } from 'lucide-react';

export const NAV_ITEMS = [
  { label: 'Главная', href: '/', icon: Home },
  { label: 'Учёт Каза', href: '/qaza', icon: Calendar },
  { label: 'Калькулятор', href: '/calculator', icon: Calculator },
  { label: 'Аналитика', href: '/analytics', icon: BarChart3 },
  { label: 'Профиль', href: '/profile', icon: User },
];
