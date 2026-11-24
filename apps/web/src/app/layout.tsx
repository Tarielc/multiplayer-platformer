import type { Metadata, Viewport } from 'next';
import { Jersey_10, Pixelify_Sans, Silkscreen } from 'next/font/google';
import type { ReactNode } from 'react';
import { GAME_TITLE } from '@/components/brand';
import './globals.css';

/** Titles, HUD numbers. */
const display = Jersey_10({ weight: '400', subsets: ['latin'], variable: '--font-display', display: 'swap' });
/** Buttons, labels, keycaps (capitals). */
const ui = Silkscreen({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-ui', display: 'swap' });
/** Sentences. */
const body = Pixelify_Sans({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

export const metadata: Metadata = {
  title: GAME_TITLE,
  description: 'An online platformer for 1-4 players: team up against the rhino or race to the trophy.',
};

export const viewport: Viewport = {
  themeColor: '#07110d',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
