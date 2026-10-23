"use client";

import { useEffect, useState } from "react";

/**
 * Fetch a signed Mux playback token for a video asset.
 *
 * In editor context: calls `/api/video/{assetId}/token` (auth required).
 * In published context: calls `/api/published/video-token/{assetId}?publishId=...`
 * using the global `window.__PRAXITY_CONFIG__` injected by the Astro layout.
 *
 * Returns null until the token is fetched.
 */
export function useMuxToken(assetId: string | undefined): string | null {
	const [token, setToken] = useState<string | null>(null);

	useEffect(() => {
		if (!assetId) return;

		// Check for published context (Astro-rendered output)
		const praxityConfig = (
			typeof window !== "undefined"
				? (window as unknown as Record<string, unknown>).__PRAXITY_CONFIG__
				: undefined
		) as { trackingUrl?: string; publishId?: string } | undefined;

		let url: string;
		if (praxityConfig?.publishId && praxityConfig?.trackingUrl) {
			// Published course — use public endpoint with publishId
			url = `${praxityConfig.trackingUrl}/api/published/video-token/${assetId}?publishId=${praxityConfig.publishId}`;
		} else if (praxityConfig?.publishId) {
			// Published but no trackingUrl — relative URL
			url = `/api/published/video-token/${assetId}?publishId=${praxityConfig.publishId}`;
		} else {
			// Editor context — use auth'd endpoint
			url = `/api/video/${assetId}/token`;
		}

		fetch(url)
			.then((r) => {
				if (!r.ok) throw new Error(`Token fetch failed: ${r.status}`);
				return r.json();
			})
			.then((data: { token?: string }) => setToken(data.token ?? null))
			.catch(() => {
				// Token fetch failed — video won't play but don't crash
			});
	}, [assetId]);

	return token;
}
