import { shouldAttachIslandAutomatically } from "@praxity/shared-blocks/self-check-consumers";
import { observeEmbedFailure } from "@praxity/shared-blocks/video-url-utils";
import { enhanceDisclosure } from "../disclosure";

function readBound(element: HTMLElement, name: "startTime" | "endTime"): number | undefined {
	const value = Number(element.dataset[name]);
	return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function enhanceDirectVideo(video: HTMLVideoElement): () => void {
	const startTime = readBound(video, "startTime");
	const endTime = readBound(video, "endTime");
	if (startTime === undefined && endTime === undefined) return () => {};

	const seekToStart = () => {
		if (startTime !== undefined && video.currentTime < startTime) video.currentTime = startTime;
	};
	const enforceEnd = () => {
		seekToStart();
		if (endTime === undefined || video.currentTime < endTime) return;
		video.pause();
		if (Math.abs(video.currentTime - endTime) > 0.05) video.currentTime = endTime;
	};
	const initialize = () => {
		if (startTime !== undefined) video.currentTime = startTime;
	};

	video.addEventListener("loadedmetadata", initialize);
	video.addEventListener("seeking", enforceEnd);
	video.addEventListener("timeupdate", enforceEnd);
	if (video.readyState >= HTMLMediaElement.HAVE_METADATA) initialize();

	return () => {
		video.removeEventListener("loadedmetadata", initialize);
		video.removeEventListener("seeking", enforceEnd);
		video.removeEventListener("timeupdate", enforceEnd);
	};
}

function enhanceVimeo(iframe: HTMLIFrameElement): () => void {
	const startTime = readBound(iframe, "startTime");
	const endTime = readBound(iframe, "endTime");
	if (startTime === undefined && endTime === undefined) return () => {};
	let stoppedAtEnd = false;
	const post = (method: string, value?: unknown) => {
		iframe.contentWindow?.postMessage(
			value === undefined ? { method } : { method, value },
			"https://player.vimeo.com",
		);
	};
	const initialize = () => {
		post("addEventListener", "timeupdate");
		if (startTime !== undefined) post("setCurrentTime", startTime);
		if (iframe.dataset.autoplay === "true") post("play");
	};
	const onMessage = (event: MessageEvent) => {
		if (event.origin !== "https://player.vimeo.com" || event.source !== iframe.contentWindow) {
			return;
		}
		let message: unknown = event.data;
		if (typeof message === "string") {
			try {
				message = JSON.parse(message);
			} catch {
				return;
			}
		}
		if (!message || typeof message !== "object") return;
		const payload = message as { event?: string; data?: { seconds?: unknown } };
		if (payload.event === "ready") {
			initialize();
			return;
		}
		if (payload.event !== "timeupdate" || typeof payload.data?.seconds !== "number") return;
		const seconds = payload.data.seconds;
		if (startTime !== undefined && seconds < startTime) {
			post("setCurrentTime", startTime);
			return;
		}
		if (endTime === undefined || seconds < endTime) {
			stoppedAtEnd = false;
			return;
		}
		if (stoppedAtEnd) return;
		stoppedAtEnd = true;
		post("pause");
		post("setCurrentTime", endTime);
	};

	iframe.addEventListener("load", initialize);
	window.addEventListener("message", onMessage);
	initialize();
	return () => {
		iframe.removeEventListener("load", initialize);
		window.removeEventListener("message", onMessage);
	};
}

function enhanceMedia(root: HTMLElement): () => void {
	if (root.dataset.mediaEnhanced === "true") return () => {};
	root.dataset.mediaEnhanced = "true";
	const cleanups = [
		...Array.from(root.querySelectorAll<HTMLIFrameElement>("iframe")).map(observeEmbedFailure),
		...Array.from(
			root.querySelectorAll<HTMLButtonElement>(
				".praxity-media-transcript [data-disclosure-trigger]",
			),
		).flatMap((button) => {
			const panel = document.getElementById(button.getAttribute("aria-controls") ?? "");
			return panel && root.contains(panel) ? [enhanceDisclosure(button, panel).destroy] : [];
		}),
		...Array.from(root.querySelectorAll<HTMLVideoElement>("video")).map(enhanceDirectVideo),
		...Array.from(
			root.querySelectorAll<HTMLIFrameElement>('iframe[data-media-provider="vimeo"]'),
		).map(enhanceVimeo),
	];
	return () => {
		cleanups.forEach((cleanup) => cleanup());
		delete root.dataset.mediaEnhanced;
	};
}

export function initMediaEnhancements(scope: ParentNode = document): () => void {
	const cleanups = Array.from(scope.querySelectorAll<HTMLElement>('[data-island="media"]')).map(
		enhanceMedia,
	);
	return () => cleanups.forEach((cleanup) => cleanup());
}

export { initMediaEnhancements as attachIsland };

if (shouldAttachIslandAutomatically()) initMediaEnhancements();
