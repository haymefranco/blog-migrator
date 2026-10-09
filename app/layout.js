import './globals.css';
import SpotifyPlayer from '@/components/SpotifyPlayer';

export const metadata = {
  title: 'Blog Migrator',
  description: 'Scrape a blog to CSV + WXR (+ images)',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <SpotifyPlayer />
      </body>
    </html>
  );
}