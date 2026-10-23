/** Result-specific text wins over option feedback, then generic question text.
 * Legacy feedback timing values are settings, not learner prose. */
export function assessmentFeedbackText(
	question: { correct?: string; incorrect?: string; feedback?: string },
	options: { correct?: string; incorrect?: string } = {},
): { correct?: string; incorrect?: string } {
	const generic =
		question.feedback &&
		!["immediate", "after-submit", "after-all", "never", "deferred"].includes(question.feedback)
			? question.feedback
			: undefined;
	return {
		correct: question.correct ?? options.correct ?? generic,
		incorrect: question.incorrect ?? options.incorrect ?? generic,
	};
}
