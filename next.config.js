/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep cheerio out of the webpack bundle; it uses Node built-ins.
    serverComponentsExternalPackages: ['cheerio'],
  },
};

module.exports = nextConfig;