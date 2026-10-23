const EMBED_HOSTS = [
	"www.youtube.com",
	"youtube.com",
	"www.youtube-nocookie.com",
	"youtube-nocookie.com",
	"youtu.be",
	"player.vimeo.com",
	"vimeo.com",
	"www.vimeo.com",
	"www.loom.com",
	"loom.com",
	"docs.google.com",
	"drive.google.com",
	"www.google.com",
	"maps.google.com",
	"www.figma.com",
	"figma.com",
	"embed.figma.com",
	"codepen.io",
	"codesandbox.io",
	"calendly.com",
	"tally.so",
	"twitter.com",
	"x.com",
	"platform.twitter.com",
	"miro.com",
	"www.canva.com",
	"canva.com",
	"airtable.com",
	"www.notion.so",
	"notion.so",
	"h5p.org",
	"padlet.com",
	"view.genial.ly",
	"view.genially.com",
	"www.mentimeter.com",
	"www.menti.com",
	"www.surveymonkey.com",
	"open.spotify.com",
	"soundcloud.com",
	"w.soundcloud.com",
	"www.slideshare.net",
] as const;

const EMBED_HOST_SET = new Set<string>(EMBED_HOSTS);
const EMBED_DOMAIN_SUFFIXES = ["typeform.com", "h5p.com"] as const;

/** Keep iframe CSP policy derived from the same allowlist used by the renderer. */
export const EMBED_FRAME_CSP_SOURCES: readonly string[] = Object.freeze([
	...EMBED_HOSTS.map((hostname) => `https://${hostname}`),
	...EMBED_DOMAIN_SUFFIXES.flatMap((suffix) => [`https://${suffix}`, `https://*.${suffix}`]),
]);

export function isEmbeddableHost(src: string): boolean {
	try {
		const url = new URL(src);
		const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
		if (EMBED_HOST_SET.has(hostname)) {
			return hostname !== "www.google.com" || url.pathname.startsWith("/maps/embed");
		}
		return EMBED_DOMAIN_SUFFIXES.some(
			(suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
		);
	} catch {
		return false;
	}
}

export function getEmbedHostLabel(src: string): string {
	try {
		return new URL(src).hostname;
	} catch {
		return src;
	}
}
