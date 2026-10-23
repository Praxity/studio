import {
	selfCheckEpochTicket,
	setSelfCheckTimeout,
	shouldAttachIslandAutomatically,
} from "@praxity/shared-blocks/self-check-consumers";

const strings = window.__PRAXITY_STRINGS__ ?? {};

export function initCodeEnhancements(): void {
	document.querySelectorAll<HTMLButtonElement>("[data-code-copy]").forEach((button) => {
		button.addEventListener("click", async () => {
			const current = selfCheckEpochTicket();
			const container = button.closest<HTMLElement>(".praxity-code-container");
			const code = Array.from(container?.querySelectorAll<HTMLElement>("[data-code-line]") ?? [])
				.map((line) => line.textContent ?? "")
				.join("\n");
			const status = container?.querySelector<HTMLElement>("[data-code-copy-status]");
			if (!container || !navigator.clipboard) return;
			try {
				await navigator.clipboard.writeText(code);
				if (!current()) return;
				button.textContent = strings.copied ?? "Copied!";
				if (status) status.textContent = strings.copiedToClipboard ?? "Copied to clipboard";
				setSelfCheckTimeout(
					() => {
						if (!current()) return;
						button.textContent = strings.copyLabel ?? "Copy";
						if (status) status.textContent = "";
					},
					2_000,
					current,
				);
			} catch {
				// Keep the usable code fallback when clipboard permission is unavailable.
			}
		});
	});
}

export { initCodeEnhancements as attachIsland };

if (shouldAttachIslandAutomatically()) initCodeEnhancements();
