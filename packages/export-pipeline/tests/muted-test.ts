import { test as base } from "@playwright/test";

/** Silence media on the shared desktop while preserving the playback clock. */
export const test = base.extend<{ muteMedia: undefined }>({
	muteMedia: [
		async ({ context }, use) => {
			// Third-party embeds in the catalog are examples, not a dependency of local checks.
			await context.route("https://**", (route) => route.abort());
			await context.addInitScript(() => {
				document.addEventListener(
					"play",
					(event) => {
						if (event.target instanceof HTMLMediaElement) event.target.muted = true;
					},
					true,
				);
				const play = HTMLMediaElement.prototype.play;
				HTMLMediaElement.prototype.play = function () {
					this.muted = true;
					return play.call(this);
				};
			});
			await use(undefined);
		},
		{ auto: true },
	],
});
