import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: process.env.NEXT_PUBLIC_APP_NAME ?? 'Al-Majeed ERP',
    template: `%s · ${process.env.NEXT_PUBLIC_APP_NAME ?? 'Al-Majeed ERP'}`,
  },
  description:
    'Clients, projects, employees, finance, documents, tasks, analytics and an AI assistant ' +
    'in one system of record.',
  // This is an internal business system; it should never appear in a search index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-surface text-ink antialiased">{children}</body>
    </html>
  );
}
