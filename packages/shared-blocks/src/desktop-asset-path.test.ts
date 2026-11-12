import { expect, it } from "vitest";
import { matchingDesktopAssetPath } from "./desktop-asset-path";

it("matches publication asset keys before URL decoding and preserves supported aliases", () => {
	const paths = new Set(["assets/my signal.gif", "assets/caf\u00e9.gif", "assets/my%20signal.gif"]);
	expect(matchingDesktopAssetPath("/assets/my%20signal.gif?x#y", paths)).toBe(
		"assets/my%20signal.gif",
	);
	expect(
		matchingDesktopAssetPath("./assets/my%20signal.gif", new Set(["assets/my signal.gif"])),
	).toBe("assets/my signal.gif");
	expect(matchingDesktopAssetPath("/assets/caf%C3%A9.gif", paths)).toBe("assets/caf\u00e9.gif");
	expect(matchingDesktopAssetPath("/assets/bad%.gif", paths)).toBeUndefined();
});
