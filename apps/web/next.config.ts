import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Explicit on purpose: the Phaser mount and the game socket are written to survive
  // Strict Mode's mount -> unmount -> mount in development.
  reactStrictMode: true,
  // The shared package ships TypeScript source (no build step).
  transpilePackages: ['@platformer/shared'],
  // To open the dev server from another device on your LAN, list its host here:
  // allowedDevOrigins: ['192.168.1.20'],
};

export default nextConfig;
