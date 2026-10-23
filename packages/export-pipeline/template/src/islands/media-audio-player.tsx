import {
	NarrationBar,
	type NarrationController,
	type NarrationStrings,
} from "@praxity/shared-blocks/viewer/narration-bar";
import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { enhanceDisclosure } from "../disclosure";

/** Audio blocks use the narration entry, which already owns the React player. */
export function mountAudioPlayer(
	mount: HTMLElement,
	src: string,
	strings: NarrationStrings,
): () => void {
	const autoplay = mount.querySelector("audio")?.autoplay === true;
	const controller = createRef<NarrationController>();
	const root = createRoot(mount);
	flushSync(() =>
		root.render(
			<NarrationBar
				items={[{ id: mount.closest<HTMLElement>("[data-block-id]")?.dataset.blockId ?? src, src }]}
				strings={{ ...strings, narrationLabel: mount.dataset.audioTitle || strings.narrationLabel }}
				alwaysExpanded
				showSentenceControls={false}
				showFollowControl={false}
				controllerRef={controller}
			/>,
		),
	);
	if (autoplay) controller.current?.togglePlayback();
	const block = mount.closest<HTMLElement>('[data-block-type="audio"]');
	const cleanups = Array.from(
		block?.querySelectorAll<HTMLButtonElement>("[data-disclosure-trigger]") ?? [],
	).flatMap((button) => {
		const panel = document.getElementById(button.getAttribute("aria-controls") ?? "");
		return panel && block?.contains(panel) ? [enhanceDisclosure(button, panel).destroy] : [];
	});
	block?.setAttribute("data-hydrated", "");
	return () => {
		cleanups.forEach((cleanup) => cleanup());
		root.unmount();
	};
}
