import { isSmallPreviewDocument } from "@praxity/shared-blocks/course-preview-protocol";
import {
	createSelfCheckMutationObserver,
	observeSelfCheckLifetime,
	shouldAttachIslandAutomatically,
} from "@praxity/shared-blocks/self-check-consumers";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { initAssessmentGroups } from "@praxity/shared-blocks/viewer/assessment-group-runtime";

function readBlocks(doc: Document): PraxityBlock[] {
	const raw = doc.getElementById("praxity-config")?.textContent;
	if (!raw) return [];
	try {
		const config = JSON.parse(raw) as { blocks?: unknown };
		return Array.isArray(config.blocks) ? (config.blocks as PraxityBlock[]) : [];
	} catch {
		return [];
	}
}

function memberIsReady(member: HTMLElement): boolean {
	return (
		!member.matches('[data-island="assessment"]') ||
		member.hasAttribute("data-hydrated") ||
		member.querySelector('[data-assessment-submit="true"]') !== null
	);
}

export function initPublishedAssessmentGroups(doc: Document = document): () => void {
	const root = doc.getElementById("main-content");
	if (!(root instanceof HTMLElement)) return () => {};
	const blocks = readBlocks(doc);
	const readOnly = isSmallPreviewDocument(doc.defaultView?.location.search ?? "");
	const memberIds = new Set(
		blocks
			.filter((block) => block.type === "assessmentGroup")
			.flatMap((block) => {
				const ids = (block.data as { memberBlockIds?: unknown }).memberBlockIds;
				return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
			}),
	);
	if (memberIds.size === 0) return () => {};

	let disposeRuntime: (() => void) | undefined;
	let observer: MutationObserver | undefined;
	let releaseObserver: (() => void) | undefined;
	const startWhenReady = () => {
		const members = new Map<string, HTMLElement>();
		root.querySelectorAll<HTMLElement>("[data-block-id]").forEach((element) => {
			const id = element.dataset.blockId;
			if (id && memberIds.has(id) && !members.has(id)) members.set(id, element);
		});
		if (!readOnly && [...members.values()].some((member) => !memberIsReady(member))) return false;
		observer?.disconnect();
		const labels = (
			doc.defaultView as (Window & { __PRAXITY_STRINGS__?: Record<string, string> }) | null
		)?.__PRAXITY_STRINGS__;
		disposeRuntime = initAssessmentGroups({ blocks, root, labels, readOnly });
		return true;
	};

	if (!startWhenReady()) {
		if (typeof doc.defaultView?.MutationObserver !== "undefined") {
			releaseObserver = observeSelfCheckLifetime((current) => {
				observer = createSelfCheckMutationObserver(current, () => {
					if (current()) startWhenReady();
				});
				const installed = observer;
				installed.observe(root, { attributes: true, childList: true, subtree: true });
				if (current()) startWhenReady();
				return () => installed.disconnect();
			}, doc);
		}
	}

	return () => {
		releaseObserver?.();
		observer?.disconnect();
		disposeRuntime?.();
	};
}

export { initPublishedAssessmentGroups as attachIsland };

if (shouldAttachIslandAutomatically()) initPublishedAssessmentGroups();
