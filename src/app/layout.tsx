import type { Metadata, Viewport } from 'next';
import './globals.css';

const SITE_URL = 'https://bjhorseman2.github.io/Kick-The--Can/';
const DESCRIPTION =
  'Fighter-jet dogfights over the real world: photorealistic Paris, San Francisco, Yosemite, Chicago and New York. Radar-lock the bandits, fire, extract. Plays in your browser — phone or desktop.';

export const metadata: Metadata = {
  title: 'Sky Fury: World Tour',
  description: DESCRIPTION,
  openGraph: {
    title: 'Sky Fury: World Tour',
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: 'Sky Fury',
    type: 'website',
    images: [{ url: `${SITE_URL}og.png`, width: 1100, height: 700, alt: 'Sky Fury gameplay' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sky Fury: World Tour',
    description: DESCRIPTION,
    images: [`${SITE_URL}og.png`],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
