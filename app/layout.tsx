import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

/**
 * The prototype's three typefaces, self-hosted by next/font rather than
 * fetched from Google at runtime. Same result, no third-party request on
 * every page load and no flash of fallback text while it arrives.
 */
const display = Space_Grotesk({
  subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display', display: 'swap',
});
const body = IBM_Plex_Sans({
  subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body', display: 'swap',
});
const mono = JetBrains_Mono({
  subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap',
});

export const metadata: Metadata = {
  title: 'PokAI — Scan. Know. Track. Grow.',
  description: 'Point a phone at a Pokémon card and know exactly which card it is and what it is worth.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0A0A0D',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
