'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import BottomNav from '@/components/BottomNav';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Determine if current route belongs to public authentication flows
  const isAuthRoute =
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password');

  // For public auth flows: no Sidebar and no BottomNav
  if (isAuthRoute) {
    return <>{children}</>;
  }

  // Authenticated App Shell with responsive desktop Sidebar and mobile BottomNav
  return (
    <>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex-1 flex justify-center w-full">
          <main className="w-full max-w-4xl p-4 md:p-8 pb-24 md:pb-8">
            {children}
          </main>
        </div>
      </div>
      <BottomNav />
    </>
  );
}
