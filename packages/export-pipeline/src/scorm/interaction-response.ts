/** Keep the UTF-16 field budget without cutting a Unicode code point in half. */
export function truncateInteractionResponse(response: string, limit: number): string {
	const last = response.charCodeAt(limit - 1);
	const next = response.charCodeAt(limit);
	const splitPair = last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
	return response.slice(0, splitPair ? limit - 1 : limit);
}
