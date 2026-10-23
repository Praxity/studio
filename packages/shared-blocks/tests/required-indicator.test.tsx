import { MantineProvider } from "@mantine/core";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RequiredIndicator } from "../src/components";

const wrap = (ui: React.ReactElement) => render(<MantineProvider>{ui}</MantineProvider>);

describe("RequiredIndicator", () => {
	it("renders without crashing", () => {
		expect(() => wrap(<RequiredIndicator />)).not.toThrow();
	});

	it("has an aria-hidden plain asterisk marker", () => {
		const { container } = wrap(<RequiredIndicator />);
		const marker = container.querySelector(".praxity-required-marker");
		expect(marker).not.toBeNull();
		expect(marker?.getAttribute("aria-hidden")).toBe("true");
		expect(container.querySelector("svg")).toBeNull();
	});

	it("contains visually-hidden 'required' text", () => {
		const { container } = wrap(<RequiredIndicator />);
		const wrapper = container.querySelector(".praxity-required-indicator");
		expect(wrapper).not.toBeNull();
		expect(wrapper?.textContent).toBe("Required");
	});
});
