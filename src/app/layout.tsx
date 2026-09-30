import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import BottomNav from '@/components/BottomNav';
import Sidebar from '@/components/Sidebar';
import { LanguageProvider } from '@/context/LanguageContext';

const inter = Inter({ subsets: ['latin', 'cyrillic'] });

export const metadata: Metadata = {
  title: 'SalahTrack — Трекер намаза',
  description: 'Production-grade Muslim prayer tracking and personal accountability platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body 
        suppressHydrationWarning 
        className={`${inter.className} bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 antialiased min-h-screen`}
      >
        <LanguageProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex-1 flex justify-center w-full">
              <main className="w-full max-w-4xl p-4 md:p-8 pb-24 md:pb-8">
                {children}
              </main>
            </div>
          </div>
          <BottomNav />
        </LanguageProvider>
      </body>
    </html>
  );
}
