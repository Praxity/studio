import { expect, it } from "vitest";
import { serializeIdentity } from "../src/canonical.ts";

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
