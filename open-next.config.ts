import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No caching layer needed: every API route is force-dynamic and the dashboard keeps its data in the browser.
export default defineCloudflareConfig();
