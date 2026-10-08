# Blog Migrator

Scrape any blog → CSV + WordPress WXR + images, powered by Next.js,
Axios, and Cheerio. Deployable to Vercel.

## Quick start

    npm install
    npm run dev
    # http://localhost:3000

## Deploy

    vercel --prod

Or push to GitHub and import at https://vercel.com/new.

## Column layout (CSV)

- Heading Title
- Page Title
- Link
- Description
- pubDate           (Month DD, YYYY)
- guid              (RSS guid if available, else canonical URL)
- Summary           (plain text)
- Content           (full HTML)
- Image URLs        (remote, pipe-separated)
- Featured Image
- Local Image Paths (images/<filename>, pipe-separated — matches ZIP)
- Categories
- Tags
- Author

## Site profile options

- Discovery: Auto (sitemap → crawl), Sitemap only, Crawl only, Manual URLs
- Pagination: Path /page/{page}, Query ?page={page}, or custom pattern
- Post URL regex: override auto-detection
- Content selector: CSS selector if auto-detection picks the wrong element

## Known caveats

- JS-rendered SPAs (empty HTML in view-source) need Puppeteer instead.
- Login-gated blogs: add cookies to DEFAULT_HEADERS in lib/scraper.js.
- Cloudflare "Under Attack" will 403 Vercel IPs. Run locally instead.
- Vercel Hobby timeouts: keep concurrency ≤ 4.
- Large ZIPs (300+ posts with images) may take minutes to build in-browser.

## License

Use only on sites you own or have written permission to migrate.
