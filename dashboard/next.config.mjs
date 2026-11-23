import { BASE_PATH } from './lib/base-path.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Mission control answers beside the Julia dashboard on the same Tailscale name.
  basePath: BASE_PATH,
  reactStrictMode: true,
  // The quota readers use the machine's own Node SDK and DuckDB bindings; they stay outside the
  // bundle and load from node_modules at run time.
  serverExternalPackages: ['@mastra/code-sdk', '@mastra/duckdb', '@duckdb/node-api'],
};

export default nextConfig;
