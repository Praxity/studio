import {
	type ChoiceDependencyEvidence,
	type ChoiceDependencyView,
	choiceDependencyStatus,
} from "../../../shared-blocks/src/choice-learner-state";

/** Inject the same status owner into deliberately malformed and ordinary test views. */
export function withChoiceDependencyStatus(view: ChoiceDependencyView): ChoiceDependencyEvidence {
	return { ...view, status: (id) => choiceDependencyStatus(id, view) };
}

/** Normalize only the three authorized inert fields for frozen document comparisons. */
export function stripChoiceStateFacts(html: string): string {
	return html.replace(
		/(<script id="(?:praxity-host-config|praxity-config)" type="application\/json">)(.*?)(<\/script>)/g,
		(_match, open, json, close) => {
			const config = JSON.parse(json);
			delete config.choiceStateQuestions;
			delete config.choiceStateSignatures;
			delete config.choiceStateGroups;
			return open + JSON.stringify(config).replace(/<\/script/gi, "<\\/script") + close;
		},
	);
}
