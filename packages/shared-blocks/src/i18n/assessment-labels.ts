import { getStrings, interpolate, type LearnerStrings } from "./strings";

export function assessmentAttemptsLabel(
	used: number,
	total: number,
	locale: string,
	strings: Pick<LearnerStrings, "assessmentAttemptsUsed"> = getStrings(locale),
): string {
	const numbers = new Intl.NumberFormat(locale);
	return interpolate(strings.assessmentAttemptsUsed, {
		n: numbers.format(used),
		total: numbers.format(total),
	});
}

export function assessmentPointsLabel(
	points: number,
	locale: string,
	strings: Pick<LearnerStrings, "assessmentPoint" | "assessmentPoints"> = getStrings(locale),
): string {
	return interpolate(points === 1 ? strings.assessmentPoint : strings.assessmentPoints, {
		// Binary arithmetic tails are display noise; scoring retains the original number.
		points: new Intl.NumberFormat(locale, { maximumSignificantDigits: 15 }).format(points),
	});
}
