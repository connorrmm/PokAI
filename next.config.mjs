/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * '/' now serves the REBUILD; the original single-file app moved to
   * '/classic'.
   *
   * The rebuild kept the old app at '/' while it was unproven, which was
   * right at the time. It stopped being right once the vision scanner shipped:
   * the old app can only ever run on-device OCR, so anyone landing on '/' was
   * testing the thing we had just replaced. That happened repeatedly during
   * field testing and cost real time, and no amount of telling people which
   * URL to use fixed it -- the default was simply wrong.
   *
   * '/classic' keeps the original reachable for its portfolio and tournament
   * screens, which have not been ported yet.
   */
  async rewrites() {
    return {
      beforeFiles: [{ source: '/classic', destination: '/app.html' }],
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
