import type { Metadata, Viewport } from 'next';
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
  metadataBase: new URL('https://namozlarim.uz'),
  title: 'Namozlarim.uz — Namoz va shaxsiy intizom platformasi',
  description: 'Musulmonlar uchun namoz vaqtlarini kuzatish, qazolarni hisoblash va shaxsiy intizom platformasi',
  alternates: {
    canonical: 'https://namozlarim.uz',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/site.webmanifest',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#059669' },
    { media: '(prefers-color-scheme: dark)', color: '#090d16' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const rawLang = cookieStore.get('namozlarim_lang')?.value || cookieStore.get('salahtrack_lang')?.value;
  const langCookie = rawLang as Language | undefined;
  const initialLang: Language =
    langCookie && (langCookie === 'en' || langCookie === 'ru' || langCookie === 'uz')
      ? langCookie
      : 'uz';

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
