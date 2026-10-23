/** Pin the two activated strings while preserving the older renderer characterizations. */
export function stripChoiceRecoveryStrings(html: string): string {
	return html.replace(
		/(<script id="praxity-config" type="application\/json">)(.*?)(<\/script>)/g,
		(whole, open, json, close) => {
			const config = JSON.parse(json);
			const strings = config.strings;
			if (
				!strings ||
				(!Object.hasOwn(strings, "choiceHistoryNotice") &&
					!Object.hasOwn(strings, "choiceNewAttempt"))
			)
				return whole;
			const labels = new Map([
				[
					"This question changed after you answered it, so your earlier answer no longer counts. Select New attempt to answer it again.",
					"New attempt",
				],
				[
					"Cette question a été modifiée après votre réponse. Votre réponse précédente ne compte donc plus. Sélectionnez Nouvelle tentative pour y répondre de nouveau.",
					"Nouvelle tentative",
				],
			]);
			if (
				!labels.has(strings.choiceHistoryNotice) ||
				labels.get(strings.choiceHistoryNotice) !== strings.choiceNewAttempt
			)
				throw new Error("Unexpected choice recovery strings");
			delete strings.choiceHistoryNotice;
			delete strings.choiceNewAttempt;
			return open + JSON.stringify(config).replace(/<\/script/gi, "<\\/script") + close;
		},
	);
}

/** Normalize only authorized additions for frozen document comparisons. */
export function stripChoiceStateFacts(html: string): string {
	return stripChoiceRecoveryStrings(html).replace(
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
