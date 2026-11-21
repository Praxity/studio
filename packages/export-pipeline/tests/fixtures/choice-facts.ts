import type {
	ChoiceDependencyEvidence,
	ChoiceDependencyView,
} from "../../../shared-blocks/src/choice-learner-state";
import * as choiceOwner from "../../../shared-blocks/src/choice-learner-state";

export function withChoiceDependencyStatus(view: ChoiceDependencyView): ChoiceDependencyEvidence {
	return Object.hasOwn(choiceOwner, "bindChoiceDependencyView")
		? choiceOwner.bindChoiceDependencyView(view)
		: {
				...view,
				status: (id, candidate = view) => choiceOwner.choiceDependencyStatus(id, candidate),
				prepareGroupSubmission: choiceOwner.prepareChoiceGroupSubmission,
			};
}

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
