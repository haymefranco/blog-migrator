import './globals.css';

export const metadata = {
  title: 'Blog Migrator',
  description: 'Scrape a blog to CSV + WXR (+ images)',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}