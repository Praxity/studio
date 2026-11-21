import { test as base } from "@playwright/test";

export const test = base.extend<{ muteMedia: undefined }>({
	muteMedia: [
		async ({ context }, use) => {
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
