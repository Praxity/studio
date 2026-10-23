import {
	createSelfCheckResizeObserver,
	observeSelfCheckLifetime,
} from "@praxity/shared-blocks/self-check-consumers";
import {
	NarrationBar,
	type NarrationBarProps,
	type NarrationController,
} from "@praxity/shared-blocks/viewer/narration-bar";
import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

/** The deck owns access and logical slides; the shared player owns media state. */
export function mountDeckNarration({
	mount,
	settingsContainer,
	settingsMount,
	...props
}: Omit<NarrationBarProps, "alwaysExpanded" | "controllerRef"> & {
	mount: HTMLElement;
	settingsContainer: HTMLElement;
}): NarrationController & { destroy(): void } {
	const controller = createRef<NarrationController>();
	const root = createRoot(mount);
	// CSS owns the footer breakpoint, including framed and preview containers.
	const isNarrow = () =>
		!!settingsMount && getComputedStyle(settingsMount.element).display !== "none";
	let narrow = isNarrow();
	// Read the shell's CSS breakpoint so embedded decks use their own width.
	const isSeekHidden = () => {
		const position = mount.querySelector(".praxity-narration-position");
		return position !== null && getComputedStyle(position).display === "none";
	};
	let seekHidden = false;
	let disposed = false;
	const render = () =>
		flushSync(() => {
			root.render(
				<NarrationBar
					{...props}
					alwaysExpanded
					showSentenceControls={false}
					showFollowControl={false}
					controllerRef={controller}
					settingsMount={narrow ? settingsMount : null}
					seekMount={seekHidden ? settingsMount?.element : null}
				/>,
			);
		});
	render();
	seekHidden = isSeekHidden();
	if (seekHidden) render();
	const releaseObserver = observeSelfCheckLifetime((current) => {
		const observer = createSelfCheckResizeObserver(current, () => {
			if (disposed || !current()) return;
			const next = isNarrow();
			const nextSeekHidden = isSeekHidden();
			if (next === narrow && nextSeekHidden === seekHidden) return;
			narrow = next;
			seekHidden = nextSeekHidden;
			render();
		});
		observer.observe(settingsContainer);
		return () => observer.disconnect();
	}, mount.ownerDocument);
	return {
		selectSegment(index) {
			let selected = false;
			flushSync(() => {
				selected = controller.current?.selectSegment(index) ?? false;
			});
			return selected;
		},
		togglePlayback() {
			return controller.current?.togglePlayback() ?? false;
		},
		pause() {
			controller.current?.pause();
		},
		setFollow(enabled) {
			flushSync(() => controller.current?.setFollow(enabled));
		},
		resumeFollow() {
			flushSync(() => controller.current?.resumeFollow());
		},
		destroy() {
			disposed = true;
			releaseObserver();
			root.unmount();
		},
	};
}
