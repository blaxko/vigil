/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // wallet-adapter and web3.js pull in a couple of node-only deps that
    // aren't needed client-side; stub them out so the browser bundle builds.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, os: false, path: false };
    return config;
  },
};

module.exports = nextConfig;
