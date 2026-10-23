import { isSafeCaptionTrackUrl, isSafeMediaUrl } from "../../utils.ts";
import type { BlockSchema } from "../validation-types.ts";

export const videoSchema: BlockSchema = {
	keyword: "video",
	blockType: "video",
	attributes: {
		src: {
			type: "url",
			required: true,
			errorLevel: "error",
			validate(value, block) {
				if (typeof value !== "string" || !value) return [];
				if (isSafeMediaUrl(value)) return [];
				return [
					{
						id: "unsafe-media-url",
						level: "critical",
						message: "Video URL uses an unsafe protocol.",
						blockId: block.id,
						blockType: block.type,
						attribute: "src",
						category: "security",
					},
				];
			},
		},
		caption: { type: "string", required: false },
		captions: {
			type: "url",
			required: false,
			errorLevel: "warning",
			validate(value, block) {
				if (value === undefined || isSafeCaptionTrackUrl(value)) return [];
				return [
					{
						id: "invalid-caption-track",
						level: "warning",
						message: "Captions must reference a safe WebVTT file path or HTTPS WebVTT URL.",
						blockId: block.id,
						blockType: block.type,
						attribute: "captions",
						category: "accessibility",
					},
				];
			},
		},
	},
	validate(block) {
		const data = block.data as Record<string, unknown>;
		const directVideo =
			typeof data.src === "string" && /\.(?:mp4|webm|ogg|mov)(?:[?#]|$)/i.test(data.src);
		const tracks = Array.isArray(data.captionTracks) ? data.captionTracks : [];
		if (
			directVideo &&
			(isSafeCaptionTrackUrl(data.captions) ||
				isSafeCaptionTrackUrl(data.captionsSrc) ||
				tracks.some(
					(track) =>
						track &&
						typeof track === "object" &&
						(track.kind === "captions" || track.kind === "subtitles") &&
						isSafeCaptionTrackUrl(track.src),
				))
		)
			return [];
		return [
			{
				id: "video-missing-captions",
				level: "warning",
				message: "Video should provide captions for accessibility.",
				blockId: block.id,
				blockType: block.type,
				category: "accessibility",
			},
		];
	},
};
