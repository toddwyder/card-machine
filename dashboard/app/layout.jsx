import { Zilla_Slab, Source_Sans_3 } from 'next/font/google';
import './globals.css';

const slab = Zilla_Slab({ subsets: ['latin'], weight: ['400', '600'], display: 'swap', variable: '--font-slab' });
const sans = Source_Sans_3({ subsets: ['latin'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-sans' });

export const metadata = {
  title: 'Mission control · Run view',
  description: 'Where the machine is, what it has used, and anything wrong.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${slab.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
