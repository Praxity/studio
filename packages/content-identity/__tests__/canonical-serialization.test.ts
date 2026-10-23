import { afterEach, expect, it, vi } from "vitest";
import { serializeIdentity } from "../src/canonical.ts";

afterEach(() => vi.restoreAllMocks());

it("serializes each repeated property name once within a canonical value", () => {
	const stringify = vi.spyOn(JSON, "stringify");
	expect(
		serializeIdentity([
			{ schema: 1, nodes: {} },
			{ nodes: {}, schema: 1 },
		]),
	).toBe('[{"nodes":{},"schema":1},{"nodes":{},"schema":1}]');
	expect(stringify.mock.calls.filter(([value]) => value === "schema")).toHaveLength(1);
	expect(stringify.mock.calls.filter(([value]) => value === "nodes")).toHaveLength(1);
});

it("preserves exact lexical key order, escaping, Unicode and omitted undefined fields", () => {
	expect(
		serializeIdentity({
			z: 'café\n"\\',
			2: -0,
			10: [true, null, 1.25],
			absent: undefined,
			__proto__: null,
			a: JSON.parse('{"__proto__":"owned","constructor":"value"}'),
		}),
	).toBe(
		'{"10":[true,null,1.25],"2":0,"a":{"__proto__":"owned","constructor":"value"},"z":"café\\n\\"\\\\"}',
	);
});

it("does not retain serialized names or caller values between calls", () => {
	const value = { name: "first" };
	expect(serializeIdentity(value)).toBe('{"name":"first"}');
	value.name = "other";
	const stringify = vi.spyOn(JSON, "stringify");
	expect(serializeIdentity(value)).toBe('{"name":"other"}');
	expect(stringify.mock.calls.filter(([value]) => value === "name")).toHaveLength(1);
});
