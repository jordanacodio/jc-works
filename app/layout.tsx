import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://jc-works-basketball.jordanacodio.chatgpt.site'),
  title: 'JC Works | Built Around Your Game',
  description: 'Personalized basketball workouts, film feedback, and progress tracking for high-school and college players.',
  openGraph: {
    title: 'JC Works | Built Around Your Game',
    description: 'Personalized basketball workouts, film feedback, and progress tracking for high-school and college players.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'JC Works | Built Around Your Game',
    description: 'Personalized basketball workouts, film feedback, and progress tracking for high-school and college players.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
