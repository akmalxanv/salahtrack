import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Inter } from 'next/font/google';
import './globals.css';
import { LanguageProvider } from '@/context/LanguageContext';
import { AuthProvider } from '@/context/AuthContext';
import { Language } from '@/locales/translations';
import AppShell from '@/components/AppShell';
import { getCurrentSession } from '@/lib/auth/guard';

const inter = Inter({ subsets: ['latin', 'cyrillic'] });

export const metadata: Metadata = {
  title: 'SalahTrack — Prayer Tracking & Accountability',
  description: 'Production-grade Muslim prayer tracking and personal accountability platform',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const langCookie = cookieStore.get('salahtrack_lang')?.value as Language | undefined;
  const initialLang: Language =
    langCookie && (langCookie === 'en' || langCookie === 'ru' || langCookie === 'uz')
      ? langCookie
      : 'en';

  const session = await getCurrentSession();
  const initialUser = session?.user || null;

  return (
    <html lang={initialLang} suppressHydrationWarning>
      <body 
        suppressHydrationWarning 
        className={`${inter.className} bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 antialiased min-h-screen`}
      >
        <LanguageProvider initialLang={initialLang}>
          <AuthProvider initialUser={initialUser}>
            <AppShell>
              {children}
            </AppShell>
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
