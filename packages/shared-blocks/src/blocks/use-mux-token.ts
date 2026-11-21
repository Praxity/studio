"use client";

import { useEffect, useState } from "react";

export function useMuxToken(assetId: string | undefined): string | null {
	const [token, setToken] = useState<string | null>(null);

	useEffect(() => {
		if (!assetId) return;

		const praxityConfig = (
			typeof window !== "undefined"
				? (window as unknown as Record<string, unknown>).__PRAXITY_CONFIG__
				: undefined
		) as { trackingUrl?: string; publishId?: string } | undefined;

		let url: string;
		if (praxityConfig?.publishId && praxityConfig?.trackingUrl) {
			url = `${praxityConfig.trackingUrl}/api/published/video-token/${assetId}?publishId=${praxityConfig.publishId}`;
		} else if (praxityConfig?.publishId) {
			url = `/api/published/video-token/${assetId}?publishId=${praxityConfig.publishId}`;
		} else {
			url = `/api/video/${assetId}/token`;
		}

		fetch(url)
			.then((r) => {
				if (!r.ok) throw new Error(`Token fetch failed: ${r.status}`);
				return r.json();
			})
			.then((data: { token?: string }) => setToken(data.token ?? null))
			.catch(() => {});
	}, [assetId]);

	return token;
}
