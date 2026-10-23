import { describe, expect, it } from "vitest";
import { readBlockFixture as readSource, replayLesson } from "./helpers/lesson-fixture.ts";

function parseBody(body: string) {
	return readSource(`---\ntitle: T\n---\n\n${body}\n`).blocks;
}

const CHOICE =
	"# Untitled {hideTitle}\n\n::: choice Which PPE is required? {display=scenario scored level=3}\nYou arrive at a **live** site at dusk.\n(x) Hard hat and safety glasses\n( ) Safety glasses only\n:::\n";

const CHOOSE_MANY =
	"# Untitled {hideTitle}\n\n::: choice Select all WHMIS symbols. {level=3}\nMore than one answer applies.\n[x] Flame symbol\n[ ] Smiley face\n:::\n";

const MATCH =
	"# Untitled {hideTitle}\n\n::: match Match each hazard to its control. {level=3}\nEvery hazard has exactly one control.\n- Chemical spill -> Containment kit\n- Fall risk -> Harness\nplaceholder: Pick a control\n:::\n";

const ORDER =
	"# Untitled {hideTitle}\n\n::: order Put the steps in order. {level=3}\nStart with what keeps you safe.\n1. Assess the situation\n2. Call emergency services\n:::\n";

const FREE_RESPONSE =
	"# Untitled {hideTitle}\n\n::: free-response Describe three improvements. {private level=3}\nConsider both physical and procedural changes.\nplaceholder: Type your three ideas here\nbutton: Keep this in mind\n:::\n";

const FILL_BLANK =
	"# Untitled {hideTitle}\n\n::: fill-blank Complete the safety procedure. {level=3}\nUse the exact terms from the policy.\nWorkers must complete a {permit} first.\nplaceholder: One word\n:::\n";

const CATEGORIZE =
	"# Untitled {hideTitle}\n\n::: categorize Sort these items. {level=3}\nEach item belongs to exactly one category.\n:: Head Protection\n- Hard hat\n:: Eye Protection\n- Safety goggles\n:::\n";

// Written in the serializer's canonical key order (and with bare coordinates,
// which is what it emits) so this asserts the new param and nothing else.
const HOTSPOT =
	"# Untitled {hideTitle}\n\n::: hotspot Select the pressure gauge.\nLook for the dial near the top.\n![Fire extinguisher diagram](/assets/fire-extinguisher.webp)\n- Pressure gauge {x=30 y=15 correct}\n:::\n";

describe("assessment description + placeholder", () => {
	it.each([
		["choose-one", CHOICE],
		["choose-many", CHOOSE_MANY],
		["match", MATCH],
		["order", ORDER],
		["free-response", FREE_RESPONSE],
		["fill-blank", FILL_BLANK],
		["categorize", CATEGORIZE],
		["hotspot", HOTSPOT],
	])("parses description on %s", (_label, source) => {
		const [block] = parseBody(source);
		expect(block.type).toBe("assessment");
		if (_label === "fill-blank") {
			// G4 keeps fill-blank instructions in the visible response template.
			expect(block.data.response.template).toContain("Use the exact terms from the policy.");
			return;
		}
		expect(Array.isArray(block.data.description)).toBe(true);
		expect(block.data.description.length).toBeGreaterThan(0);
	});

	it.each([
		["match", MATCH, "Pick a control"],
		["free-response", FREE_RESPONSE, "Type your three ideas here"],
		["fill-blank", FILL_BLANK, "One word"],
	])("parses placeholder on %s", (_label, source, expected) => {
		const [block] = parseBody(source);
		expect(block.data.response.placeholder).toBe(expected);
	});

	it("parses a custom free-response button label", () => {
		const [block] = parseBody(FREE_RESPONSE);
		expect(block.data.buttonLabel).toBe("Keep this in mind");
		expect(block.data.private).toBe(true);
	});

	it("keeps scenario display metadata through the preview adapter", () => {
		const [block] = parseBody(CHOICE);
		expect(block.data.display).toBe("scenario");
	});

	// Round-tripping matters more than it sounds: the desktop app reserializes on
	// every save, so a param the serializer forgets is a param the author loses.
	it.each([
		["choose-one", CHOICE],
		["choose-many", CHOOSE_MANY],
		["match", MATCH],
		["order", ORDER],
		["free-response", FREE_RESPONSE],
		["fill-blank", FILL_BLANK],
		["categorize", CATEGORIZE],
		["hotspot", HOTSPOT],
	])("round-trips %s through parse → serialize unchanged", (_label, source) => {
		const blocks = parseBody(source);
		const reserialized = replayLesson(readSource(source));
		expect(reserialized).toBe(source);
		// And parsing the output again is stable.
		expect(parseBody(reserialized)[0].data).toEqual(blocks[0].data);
	});

	it("coerces numeric-looking assessment prose back to strings", () => {
		const [block] = parseBody(
			"# Untitled {hideTitle}\n\n::: free-response Q {level=3}\n2024\nbutton: 2025\n:::\n",
		);
		expect(block.data.description).toMatchObject([
			{ type: "text", data: { content: "<p>2024</p>" } },
		]);
		expect(block.data.buttonLabel).toBe("2025");
	});

	it("keeps the legacy free-response body as the placeholder", () => {
		const [block] = parseBody(
			"# Untitled {hideTitle}\n\n::: free-response Describe three improvements. {level=3}\nplaceholder: Consider both changes.\n:::\n",
		);
		expect(block.data.response.placeholder).toBe("Consider both changes.");
	});

	it("lets an explicit placeholder param win over the legacy body", () => {
		const [block] = parseBody(
			"# Untitled {hideTitle}\n\n::: free-response Q {level=3}\nplaceholder: Type here\n:::\n\nIgnored body text.\n",
		);
		expect(block.data.response.placeholder).toBe("Type here");
	});

	it("keeps a multi-line legacy placeholder in the body on serialize", () => {
		const source =
			"# Untitled {hideTitle}\n\n::: free-response Q {level=3}\nplaceholder: First line.\n  Second line.\n:::\n";
		const blocks = parseBody(source);
		expect(blocks[0].data.response.placeholder).toBe("First line.\nSecond line.");
		expect(replayLesson(readSource(source))).toBe(source);
	});
});
