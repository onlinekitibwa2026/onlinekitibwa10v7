import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/** @type {import('next').NextConfig} */
const nextConfig = { eslint: { ignoreDuringBuilds: true } };

// Lets `next dev` read .dev.vars the same way the deployed Worker reads its secrets
initOpenNextCloudflareForDev();

export default nextConfig;
