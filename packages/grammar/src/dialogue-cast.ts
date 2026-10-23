import { isInlineProjectionMetadataKey } from "@praxity/content-model/inline-fields";
import type { DialogueSpeakerData, PraxityBlock } from "@praxity/content-model/types";

export interface CastMember {
	name: string;
	avatar?: string;
	voice?: string;
	side?: "start" | "end";
}

export type DialogueCast = Record<string, CastMember>;
export type DialogueSpeakerWarning = {
	blockId: string;
	code: "unknown-speaker" | "invalid-avatar" | "invalid-side";
	speaker: string;
	avatar?: string;
	side?: string;
};

const KEY_RE = /^\p{L}[\p{L}\p{N}_-]*$/u;
const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
const isProjectAvatar = (value: string): boolean =>
	!(/^[a-z][a-z\d+.-]*:/iu.test(value) || value.startsWith("//"));
export const isAvatarNone = (value: string): boolean => value.trim().toLowerCase() === "none";

export function normalizeDialogueCast(
	raw: unknown,
	locale = "en",
): { cast: DialogueCast; warnings: string[] } {
	const fr = locale.startsWith("fr");
	if (raw === undefined) return { cast: {}, warnings: [] };
	if (!isRecord(raw))
		return {
			cast: {},
			warnings: [
				fr
					? "cast doit être une table de clés d'interlocuteurs."
					: "cast must be a map of speaker keys.",
			],
		};
	const cast: DialogueCast = {};
	const warnings: string[] = [];
	for (const [key, value] of Object.entries(raw)) {
		if (!KEY_RE.test(key)) {
			warnings.push(
				fr
					? `La clé cast « ${key} » doit contenir des lettres, chiffres, - ou _, sans espaces.`
					: `cast key "${key}" must be letters, digits, - or _ with no spaces.`,
			);
			continue;
		}
		if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) {
			warnings.push(
				fr ? `L'interlocuteur cast « ${key} » doit avoir un nom.` : `cast "${key}" needs a name.`,
			);
			continue;
		}
		const avatar = typeof value.avatar === "string" ? value.avatar.trim() : "";
		const side = value.side;
		const sideLabel = typeof side === "string" ? side : side === null ? "null" : typeof side;
		if (side !== undefined && side !== "start" && side !== "end")
			warnings.push(
				fr
					? `Le côté cast « ${key} » doit être start ou end : ${sideLabel}`
					: `cast "${key}" side must be start or end: ${sideLabel}`,
			);
		if (avatar && !isProjectAvatar(avatar))
			warnings.push(
				fr
					? `L'avatar cast « ${key} » doit être un fichier du projet : ${avatar}`
					: `cast "${key}" avatar must be a project asset path: ${avatar}`,
			);
		cast[key.toLowerCase()] = {
			name: value.name.trim(),
			...(avatar && isProjectAvatar(avatar) ? { avatar } : {}),
			...(typeof value.voice === "string" && value.voice.trim()
				? { voice: value.voice.trim() }
				: {}),
			...(side === "start" || side === "end" ? { side } : {}),
		};
	}
	return { cast, warnings };
}

export function resolveDialogueSpeakers(
	blocks: PraxityBlock[],
	cast: DialogueCast = {},
): { blocks: PraxityBlock[]; warnings: DialogueSpeakerWarning[] } {
	const warnings: DialogueSpeakerWarning[] = [];
	const visit = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(visit);
		if (!isRecord(value)) return value;
		const next = Object.fromEntries(
			Object.entries(value).map(([key, child]) => [
				key,
				isInlineProjectionMetadataKey(key, { keepDisplay: true }) ? child : visit(child),
			]),
		);
		const data = Object.hasOwn(next, "data") ? next.data : undefined;
		if (
			Object.hasOwn(next, "type") &&
			next.type === "dialogue" &&
			isRecord(data) &&
			Array.isArray(data.turns)
		) {
			const local = new Map<string, DialogueSpeakerData>();
			if (isRecord(data.speakers)) {
				for (const [key, speaker] of Object.entries(data.speakers)) {
					if (!isRecord(speaker)) continue;
					const fields: DialogueSpeakerData = {};
					for (const field of ["name", "avatar", "voice", "side"] as const) {
						const value = Object.hasOwn(speaker, field) ? speaker[field] : undefined;
						if (field === "side" && value !== undefined && value !== "start" && value !== "end") {
							warnings.push({
								blockId: String(next.id),
								code: "invalid-side",
								speaker: key,
								side: typeof value === "string" ? value : value === null ? "null" : typeof value,
							});
							continue;
						}
						if (typeof value !== "string" || !value.trim()) continue;
						if (field === "avatar" && !isAvatarNone(value) && !isProjectAvatar(value.trim())) {
							warnings.push({
								blockId: String(next.id),
								code: "invalid-avatar",
								speaker: key,
								avatar: value.trim(),
							});
							fields.avatar = "none";
							continue;
						}
						if (field === "side") fields.side = value as "start" | "end";
						else fields[field] = value.trim();
					}
					local.set(key.toLowerCase(), fields);
				}
			}
			next.data = {
				...data,
				turns: data.turns.map((turn) => {
					if (!isRecord(turn)) return turn;
					const { name: _name, avatar: _avatar, voice: _voice, side: _side, ...rest } = turn;
					if (typeof turn.speaker !== "string") return rest;
					const lower = turn.speaker.toLowerCase();
					const castMember = Object.hasOwn(cast, lower) ? cast[lower] : undefined;
					const merged = { ...castMember, ...local.get(lower) };
					if (!castMember && !local.has(lower)) {
						warnings.push({
							blockId: String(next.id),
							code: "unknown-speaker",
							speaker: turn.speaker,
						});
					}
					return {
						...rest,
						name: merged.name?.trim() || turn.speaker,
						...(merged.avatar && !isAvatarNone(merged.avatar) ? { avatar: merged.avatar } : {}),
						...(merged.voice ? { voice: merged.voice } : {}),
						...(merged.side === "start" || merged.side === "end" ? { side: merged.side } : {}),
					};
				}),
			};
		}
		return next;
	};
	return { blocks: visit(blocks) as PraxityBlock[], warnings };
}

export function formatDialogueWarning(
	warning: DialogueSpeakerWarning,
	locale: string,
): { blockId: string; message: string } {
	const { blockId, speaker } = warning;
	return {
		blockId,
		message:
			warning.code === "invalid-avatar"
				? locale.startsWith("fr")
					? `L'avatar « ${warning.avatar} » de ${speaker} doit être un fichier du projet dans le dialogue ${blockId}`
					: `Avatar "${warning.avatar}" for ${speaker} must be a project asset in dialogue ${blockId}`
				: warning.code === "invalid-side"
					? locale.startsWith("fr")
						? `Le côté « ${warning.side} » de ${speaker} doit être start ou end dans le dialogue ${blockId}`
						: `Side "${warning.side}" for ${speaker} must be start or end in dialogue ${blockId}`
					: locale.startsWith("fr")
						? `Interlocuteur inconnu « ${speaker} » dans le dialogue ${blockId}`
						: `Unknown speaker "${speaker}" in dialogue ${blockId}`,
	};
}
