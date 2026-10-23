import { getStrings } from "@praxity/shared-blocks/i18n/strings";
import { expect, it } from "vitest";
import { formatCourseSessionTime } from "../../template/src/components/course-completion-result";
import { readCourseSessionTime } from "../course-session-time";

it.each([
	[0, "en", "Time spent: less than a minute"],
	[0, "fr", "Temps passé : moins d'une minute"],
	[1, "en", "Time spent: 1 minute"],
	[2, "en", "Time spent: 2 minutes"],
	[60, "en", "Time spent: 1 hour"],
	[62, "en", "Time spent: 1 hour, 2 minutes"],
	[62, "fr", "Temps passé : 1 heure et 2 minutes"],
	[62, "not_a_locale", "Time spent: 1 hour, 2 minutes"],
])("formats %s minutes in %s", (minutes, locale, expected) => {
	expect(
		formatCourseSessionTime({ minutes: Number(minutes), seconds: 0 }, String(locale), {
			...getStrings(String(locale)),
		}).replaceAll("\u00a0", " "),
	).toBe(expected);
});

it("formats completion time when DurationFormat is unavailable", () => {
	const descriptor = Object.getOwnPropertyDescriptor(Intl, "DurationFormat");
	Object.defineProperty(Intl, "DurationFormat", { configurable: true, value: undefined });
	try {
		expect(
			formatCourseSessionTime({ minutes: 62, seconds: 0 }, "en", { ...getStrings("en") }),
		).toBe("Time spent: 1 hour, 2 minutes");
		expect(
			formatCourseSessionTime({ minutes: 62, seconds: 0 }, "fr", {
				...getStrings("fr"),
			}).replaceAll("\u00a0", " "),
		).toBe("Temps passé : 1 heure et 2 minutes");
	} finally {
		if (descriptor) Object.defineProperty(Intl, "DurationFormat", descriptor);
		else Reflect.deleteProperty(Intl, "DurationFormat");
	}
});

it("retains the first arrival across documents and keeps courses separate", () => {
	const values = new Map<string, string>();
	const store = () => ({
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
	});
	expect(readCourseSessionTime("one", 1000, store)).toEqual({ minutes: 0, seconds: 0 });
	expect(readCourseSessionTime("one", 126_500, store)).toEqual({ minutes: 2, seconds: 5 });
	expect(readCourseSessionTime("two", 126_500, store)).toEqual({ minutes: 0, seconds: 0 });
});

it.each(["", "not a timestamp", "-1", "500000"])("reports invalid saved time %s", (saved) => {
	expect(
		readCourseSessionTime("one", 1000, () => ({ getItem: () => saved, setItem: () => {} })),
	).toHaveProperty("error");
});

it("reports unavailable browser storage", () => {
	const error = new Error("Storage blocked");
	expect(
		readCourseSessionTime("one", 1000, () => {
			throw error;
		}),
	).toEqual({ error });
});
