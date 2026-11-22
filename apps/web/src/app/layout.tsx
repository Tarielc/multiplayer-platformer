import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Platformer Template',
  description: 'Data-driven 1-4 player 2D platformer: Next.js + Phaser 4 + authoritative Node.js server.',
};

export const viewport: Viewport = {
  themeColor: '#0e1120',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
