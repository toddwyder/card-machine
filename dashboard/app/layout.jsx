import { Source_Sans_3, Zilla_Slab } from 'next/font/google';
import './globals.css';

const zillaSlab = Zilla_Slab({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-zilla-slab',
  display: 'swap',
});

const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-source-sans',
  display: 'swap',
});

export const metadata = {
  title: 'Julia machine',
  description: 'Run view for the machine that builds Julia.',
};

export const viewport = {
  themeColor: '#1D3B27',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${zillaSlab.variable} ${sourceSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
