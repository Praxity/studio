export function json(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
	const headers = new Headers(extraHeaders);
	headers.set("Cache-Control", "no-store");
	headers.set("Content-Type", "application/json; charset=utf-8");
	headers.set("X-Content-Type-Options", "nosniff");
	return new Response(JSON.stringify(body), { status, headers });
}
