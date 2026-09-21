/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The landing page used to live at /landing and the dashboard at /; keep old links working.
  async redirects() {
    return [{ source: "/landing", destination: "/", permanent: false }];
  },
  // The dashboard lives in app/dashboard but is served at /app. A route folder literally named
  // "app" breaks Next's page resolution when the project sits at /app (Railway's container path):
  // the route for / compiled the dashboard's source instead of the landing page's.
  async rewrites() {
    return [{ source: "/app", destination: "/dashboard" }];
  },
  webpack: (config) => {
    // wallet-adapter and web3.js pull in a couple of node-only deps that
    // aren't needed client-side; stub them out so the browser bundle builds.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, os: false, path: false };
    return config;
  },
};

module.exports = nextConfig;
