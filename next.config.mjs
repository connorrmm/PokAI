/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
