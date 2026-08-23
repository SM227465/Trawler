import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// A share id IS the secret, so the page must never be indexed. The metadata
	// tag covers crawlers that run JS; this header covers the ones that do not.
	async headers() {
		return [{ source: "/s/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] }];
	},
	// Required by the Dockerfile runner stage.
	output: "standalone",
  /* config options here */
};

export default nextConfig;
