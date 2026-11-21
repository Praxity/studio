// Cloudflare Access sends a signed JWT with every request it admits, in Cf-Access-Jwt-Assertion.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

export interface AccessConfig {
	ACCESS_TEAM_DOMAIN: string;
	ACCESS_AUD: string;
}

export interface AccessIdentity {
	/** Stable Access user ID; threads belong to it. */
	sub: string;
	email: string;
}

interface Jwk extends JsonWebKey {
	kid?: string;
}

const KEY_CACHE_MS = 60 * 60 * 1000;
// A token naming an unknown key refetches at most once a minute, so forged key IDs can't
// turn every request into a fetch.
const KEY_REFRESH_MS = 60 * 1000;
let keyCache: { domain: string; at: number; keys: Jwk[] } | null = null;

async function accessKeys(domain: string, maxAgeMs: number): Promise<Jwk[]> {
	if (keyCache?.domain === domain && Date.now() - keyCache.at < maxAgeMs) return keyCache.keys;
	const response = await fetch(`https://${domain}/cdn-cgi/access/certs`);
	if (!response.ok) throw new Error(`Access keys unavailable: HTTP ${response.status}`);
	const { keys } = (await response.json()) as { keys?: unknown };
	if (!Array.isArray(keys)) throw new Error("Access keys response has no keys.");
	keyCache = { domain, at: Date.now(), keys };
	return keys;
}

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
	const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJson(value: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error("Not a JSON object");
	return parsed as Record<string, unknown>;
}

const finite = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

/**
 * Returns the verified identity, or null for a missing, malformed, expired, mis-addressed or
 * forged token. Throws only when Access's signing keys can't be fetched.
 */
export async function verifyAccessJwt(
	token: string | null,
	config: AccessConfig,
): Promise<AccessIdentity | null> {
	if (!token || !config.ACCESS_TEAM_DOMAIN || !config.ACCESS_AUD) return null;
	const parts = token.split(".");
	if (parts.length !== 3 || parts.some((part) => !part)) return null;
	const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
	let header: Record<string, unknown>;
	let payload: Record<string, unknown>;
	let signature: Uint8Array<ArrayBuffer>;
	try {
		header = decodeJson(headerPart);
		payload = decodeJson(payloadPart);
		signature = base64UrlBytes(signaturePart);
	} catch {
		return null;
	}
	const now = Date.now() / 1000;
	const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (
		header.alg !== "RS256" ||
		typeof header.kid !== "string" ||
		payload.iss !== `https://${config.ACCESS_TEAM_DOMAIN}` ||
		!audiences.includes(config.ACCESS_AUD) ||
		!finite(payload.exp) ||
		payload.exp <= now ||
		(payload.nbf !== undefined && (!finite(payload.nbf) || payload.nbf > now)) ||
		typeof payload.sub !== "string" ||
		!payload.sub ||
		typeof payload.email !== "string" ||
		!payload.email
	) {
		return null;
	}
	// Access rotates keys; refetch when the token names a key we haven't seen.
	const named = (keys: Jwk[]) => keys.find((key) => key.kid === header.kid);
	const jwk =
		named(await accessKeys(config.ACCESS_TEAM_DOMAIN, KEY_CACHE_MS)) ??
		named(await accessKeys(config.ACCESS_TEAM_DOMAIN, KEY_REFRESH_MS));
	if (!jwk) return null;
	try {
		const key = await crypto.subtle.importKey(
			"jwk",
			jwk,
			{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
			false,
			["verify"],
		);
		const valid = await crypto.subtle.verify(
			"RSASSA-PKCS1-v1_5",
			key,
			signature,
			new TextEncoder().encode(`${headerPart}.${payloadPart}`),
		);
		return valid ? { sub: payload.sub, email: payload.email.toLowerCase() } : null;
	} catch {
		return null;
	}
}
