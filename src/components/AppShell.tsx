'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import BottomNav from '@/components/BottomNav';
import { useAuth } from '@/context/AuthContext';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isGuest, loading } = useAuth();

  // Determine if current route belongs to public authentication flows
  const isAuthRoute =
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password');

  // First-time visitor handling: redirect unauthenticated non-guest visitors to /login
  useEffect(() => {
    if (!loading && !user && !isGuest && !isAuthRoute) {
      router.replace('/login');
    }
  }, [loading, user, isGuest, isAuthRoute, router]);

  // For public auth flows: no Sidebar and no BottomNav
  if (isAuthRoute) {
    return <>{children}</>;
  }

  // Authenticated / Guest App Shell with responsive desktop Sidebar and mobile BottomNav
  return (
    <>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex-1 flex justify-center w-full min-w-0">
          <main className="w-full max-w-4xl p-3.5 sm:p-6 md:p-8 pb-24 md:pb-8">
            {children}
          </main>
        </div>
      </div>
      <BottomNav />
    </>
  );
}
