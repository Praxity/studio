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
