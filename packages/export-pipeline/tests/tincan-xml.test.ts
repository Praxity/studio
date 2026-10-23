import { describe, expect, it, vi } from "vitest";
import { XapiRuntime } from "../src/scorm/api/xapi";
import { generateTincanXml } from "../src/scorm/tincan-xml";

describe("generateTincanXml", () => {
	it("produces valid XML with activity id and launch", () => {
		const xml = generateTincanXml("course-123", "Safety Training", "en");
		expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(xml).toContain("<tincan");
		expect(xml).toContain('id="https://praxity.io/courses/course-123"');
		expect(xml).toContain('name="Safety Training"');
		expect(xml).toContain('lang="en"');
		expect(xml).toContain(">index.html</launch>");
	});

	it("escapes XML special characters in title", () => {
		const xml = generateTincanXml("c-1", 'Course "A" & B', "en");
		expect(xml).toContain("&quot;A&quot; &amp; B");
	});

	it("declares an explicit activityBase as the course activity", () => {
		const xml = generateTincanXml("c-1", "Course", "en", "https://courses.example.com/my-course");
		expect(xml).toContain('id="https://courses.example.com/my-course/course"');
	});

	it("uses the declared course activity for completion statements", () => {
		const declaredId = /activity id="([^"]+)"/.exec(
			generateTincanXml("course-123", "Course", "en"),
		)?.[1];
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(null, { status: 200 }));
		try {
			new XapiRuntime(
				{
					endpoint: "https://lrs.example.com/xapi/statements",
					auth: "Basic dGVzdA==",
					actor: { name: "Learner", mbox: "mailto:learner@example.com" },
				},
				"course-123",
			).setCompletion("completed");
			const statement = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
			expect(statement.object.id).toBe(declaredId);
		} finally {
			fetchSpy.mockRestore();
		}
	});
});
