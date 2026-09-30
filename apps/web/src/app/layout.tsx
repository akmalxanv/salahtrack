import type { Metadata } from 'next';
import './globals.css';
import BottomNav from '@/components/BottomNav';

export const metadata: Metadata = {
  title: 'SalahTrack — Трекер намаза',
  description: 'Платформа трекинга намазов и личной дисциплины',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body className="min-h-screen pb-16 md:pb-0">
        <div className="mx-auto max-w-md md:max-w-4xl">
          {children}
        </div>
        <BottomNav />
      </body>
    </html>
  );
}
