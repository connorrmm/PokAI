/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Keep the WORKING app live while the rebuild happens.
   *
   * Vercel serves this project as a static index.html today. Adding a
   * package.json makes it detect Next.js instead, which would otherwise
   * replace the live scanner with whatever this app renders at '/'. That is a
   * regression users would see immediately.
   *
   * So '/' keeps serving the existing single-file app (public/app.html), and
   * the rebuild lives at '/preview' until it is genuinely better. beforeFiles
   * runs ahead of the filesystem, so this wins over any app-router page.
   *
   * When the ported UI is ready: delete this rewrite and add app/page.tsx.
   */
  async rewrites() {
    return {
      beforeFiles: [{ source: '/', destination: '/app.html' }],
      afterFiles: [],
      fallback: [],
    };
  },
  images: {
    // Card art is served from TCGPlayer. We link rather than store it --
    // tcgapi.dev is explicit that it cannot grant rights to card artwork,
    // so not copying it onto our own servers is deliberate.
    // See docs/OPEN-QUESTIONS.md #6.
    remotePatterns: [
      { protocol: 'https', hostname: 'product-images.tcgplayer.com' },
      { protocol: 'https', hostname: 'tcgapi.dev' },
    ],
  },
};
export default nextConfig;
