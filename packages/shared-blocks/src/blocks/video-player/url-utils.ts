import type { VideoSource } from "../../types";
import type { VideoSourceTier } from "./types";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "youtu.be"]);
const YOUTUBE_EMBED_HOSTS = new Set([
	"youtube.com",
	"www.youtube.com",
	"youtube-nocookie.com",
	"www.youtube-nocookie.com",
]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);
const LOOM_HOSTS = new Set(["loom.com", "www.loom.com"]);

function parseHttpsUrl(url: string): URL | null {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" ? parsed : null;
	} catch {
		return null;
	}
}

function hasSinglePathId(url: URL, prefix: string, numeric = false): boolean {
	const remainder = url.pathname.slice(prefix.length);
	return (
		url.pathname.startsWith(prefix) && (numeric ? /^\d+$/u : /^[a-zA-Z0-9_-]+$/u).test(remainder)
	);
}

/** Detect VideoSource type — returns "mux" for Mux-hosted assets, or delegates to detectVideoSource for URL sources. */
export function getVideoSourceType(source: VideoSource): VideoSourceType | "mux" {
	if (source.type === "mux") return "mux";
	return detectVideoSource(source.src);
}

/** Convert a video watch/share URL to an embeddable URL. */
export function toEmbedUrl(url: string): string {
	const u = parseHttpsUrl(url);
	if (!u) return url;
	const host = u.hostname.toLowerCase();
	if ((host === "youtube.com" || host === "www.youtube.com") && u.pathname === "/watch") {
		const id = u.searchParams.get("v") ?? "";
		if (/^[a-zA-Z0-9_-]+$/u.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
	}
	if ((host === "youtube.com" || host === "www.youtube.com") && hasSinglePathId(u, "/embed/")) {
		u.hostname = "www.youtube-nocookie.com";
		return u.toString();
	}
	if (host === "youtu.be" && hasSinglePathId(u, "/")) {
		return `https://www.youtube-nocookie.com/embed${u.pathname}`;
	}
	if ((host === "vimeo.com" || host === "www.vimeo.com") && hasSinglePathId(u, "/", true)) {
		return `https://player.vimeo.com/video${u.pathname}`;
	}
	if (LOOM_HOSTS.has(host) && hasSinglePathId(u, "/share/")) {
		return `https://www.loom.com/embed/${u.pathname.slice("/share/".length)}`;
	}
	return url;
}

export function isYouTubeEmbed(url: string): boolean {
	const parsed = parseHttpsUrl(url);
	return Boolean(
		parsed && YOUTUBE_EMBED_HOSTS.has(parsed.hostname) && hasSinglePathId(parsed, "/embed/"),
	);
}

export function getYouTubeVideoId(url: string): string | null {
	const parsed = parseHttpsUrl(url);
	if (!parsed || !YOUTUBE_EMBED_HOSTS.has(parsed.hostname) || !hasSinglePathId(parsed, "/embed/")) {
		return null;
	}
	return parsed.pathname.slice("/embed/".length);
}

export function getYouTubeThumbnailUrl(url: string): string | null {
	const id = getYouTubeVideoId(url);
	return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** A no-JS YouTube facade. The link navigates its own iframe when activated. */
export function getYouTubeFacadeSrcDoc(
	url: string,
	title: string,
	playLabel = "Play",
): string | null {
	const thumbnailUrl = getYouTubeThumbnailUrl(url);
	if (!thumbnailUrl) return null;
	const target = new URL(url);
	target.searchParams.set("autoplay", "1");
	const label = `${playLabel} ${title}`.trim();
	return `<!doctype html><meta name="viewport" content="width=device-width"><style>*{box-sizing:border-box}html,body,a{width:100%;height:100%;margin:0}a{display:block;position:relative;background:#000;overflow:hidden}img{width:100%;height:100%;object-fit:cover}.play{position:absolute;left:50%;top:50%;width:68px;height:48px;transform:translate(-50%,-50%);border-radius:12px;background:#c00;box-shadow:0 2px 12px #0008}.play:after{content:"";position:absolute;left:28px;top:13px;border-left:20px solid #fff;border-top:11px solid transparent;border-bottom:11px solid transparent}a:focus-visible{outline:4px solid #fff;outline-offset:-4px}</style><a href="${escapeAttribute(target.toString())}" aria-label="${escapeAttribute(label)}"><img src="${escapeAttribute(thumbnailUrl)}" alt="" width="480" height="360"><span class="play" aria-hidden="true"></span></a>`;
}

export function isVimeoEmbed(url: string): boolean {
	const parsed = parseHttpsUrl(url);
	return Boolean(
		parsed && parsed.hostname === "player.vimeo.com" && hasSinglePathId(parsed, "/video/", true),
	);
}

export function isEmbeddableUrl(url: string): boolean {
	const parsed = parseHttpsUrl(url);
	if (!parsed) return false;
	if (isYouTubeEmbed(url) || isVimeoEmbed(url)) return true;
	return LOOM_HOSTS.has(parsed.hostname) && hasSinglePathId(parsed, "/embed/");
}

/** Detect if URL points to a direct video file (not an iframe embed). */
export function isDirectVideoUrl(url: string): boolean {
	try {
		// Dummy base allows new URL() to parse relative paths (e.g. "/block-examples/sample.mp4")
		const u = new URL(url, "https://placeholder.invalid");
		if (!new Set(["https:", "http:", "file:", "praxity-asset:"]).has(u.protocol)) return false;
		const path = u.pathname.toLowerCase();
		return (
			path.endsWith(".mp4") ||
			path.endsWith(".webm") ||
			path.endsWith(".ogg") ||
			path.endsWith(".mov")
		);
	} catch {
		return false;
	}
}

export type VideoSourceType = "youtube" | "vimeo" | "loom" | "direct" | "unknown-embed";

/** Identify the video source from the original (non-embed) URL. */
export function detectVideoSource(url: string): VideoSourceType {
	if (!url) return "unknown-embed";
	try {
		// Dummy base allows new URL() to parse relative paths (e.g. "/videos/intro.mp4")
		const u = new URL(url, "https://placeholder.invalid");
		const isRelative = u.hostname === "placeholder.invalid";
		if (!isRelative && YOUTUBE_HOSTS.has(u.hostname)) return "youtube";
		if (!isRelative && VIMEO_HOSTS.has(u.hostname)) return "vimeo";
		if (!isRelative && LOOM_HOSTS.has(u.hostname)) return "loom";
		if (isDirectVideoUrl(url)) return "direct";
	} catch {
		// fall through
	}
	return "unknown-embed";
}

/** Map video source to its capability tier. */
export function getSourceTier(source: VideoSourceType): VideoSourceTier {
	switch (source) {
		case "youtube":
			return "partial-control";
		case "vimeo":
		case "direct":
			return "full-control";
		case "loom":
		case "unknown-embed":
			return "manual-mode";
	}
}
/** Iframe load events do not prove a cross-origin provider rendered successfully.
 * Keep the source link visible; remove the empty frame on observable failures. */
export function observeEmbedFailure(iframe: HTMLIFrameElement): () => void {
	const src = iframe.dataset.embedSrc || iframe.src;
	const view = iframe.ownerDocument.defaultView;
	if (!view) throw new Error("Embed requires a browsing context");
	const origin = new URL(src).origin;
	const retry = iframe.parentElement?.querySelector<HTMLButtonElement>("[data-embed-retry]");
	let timer: number | undefined;
	let settled = Boolean(iframe.srcdoc);
	let observer: IntersectionObserver | undefined;
	const stopTimer = () => {
		view.clearTimeout(timer);
		timer = undefined;
		observer?.disconnect();
	};
	const fail = () => {
		settled = true;
		stopTimer();
		iframe.hidden = true;
		if (retry) retry.hidden = false;
		if (iframe.ownerDocument.activeElement === iframe)
			(retry ?? iframe.parentElement?.querySelector<HTMLAnchorElement>("a[href]"))?.focus();
	};
	const waitForConfirmation = () => {
		if (settled || timer !== undefined) return;
		// A cross-origin load event also fires on network errors. If the provider
		// sends no confirmation, offer a compact fallback and explicit recovery.
		// Never infer failure from opaque, zero-valued Resource Timing fields.
		timer = view.setTimeout(fail, 3000);
	};
	const confirm = (event: MessageEvent) => {
		if (event.source !== iframe.contentWindow || event.origin !== origin || settled) return;
		settled = true;
		stopTimer();
	};
	const show = () => {
		settled = true;
		stopTimer();
		iframe.hidden = false;
		if (retry) retry.hidden = true;
		iframe.focus();
	};
	const policyFailure = (event: SecurityPolicyViolationEvent) => {
		if (event.effectiveDirective !== "frame-src") return;
		if (event.blockedURI === src || event.blockedURI === new URL(src).origin) fail();
	};
	iframe.addEventListener("error", fail);
	iframe.addEventListener("load", waitForConfirmation);
	view.addEventListener("message", confirm);
	retry?.addEventListener("click", show);
	iframe.ownerDocument.addEventListener("securitypolicyviolation", policyFailure);
	// Bind before navigation so even a synchronous CSP refusal is observed.
	// Without enhancement, the source link is the complete readable fallback.
	if (iframe.dataset.embedSrc) {
		iframe.hidden = false;
		iframe.src = src;
	}
	if (iframe.loading === "lazy" && "IntersectionObserver" in view) {
		observer = new view.IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) waitForConfirmation();
		});
		observer.observe(iframe);
	} else waitForConfirmation();
	return () => {
		stopTimer();
		iframe.removeEventListener("error", fail);
		iframe.removeEventListener("load", waitForConfirmation);
		view.removeEventListener("message", confirm);
		retry?.removeEventListener("click", show);
		iframe.ownerDocument.removeEventListener("securitypolicyviolation", policyFailure);
	};
}
