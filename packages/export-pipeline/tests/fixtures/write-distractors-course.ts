export const places = ["TOP", "ACC", "TAB", "SEQ", "COL", "FRONT", "BACK"] as const;
export const locales = ["en", "fr"] as const;
export const fields = ["RIGHT", "LABEL_A", "LABEL_B", "OPTION_A", "OPTION_B"] as const;
export const marker = (locale: string, place: string, field: string) =>
	`WD_${locale}_${place}_${field}_UNIQUE`;
export const hidden = locales.flatMap((locale) =>
	places.flatMap((place) => fields.map((field) => marker(locale, place, field))),
);
export const prompt = (locale: string, place: string) => `PROMPT_${locale}_${place}_CONTROL`;
export const activity = (locale: string, place: string) => {
	const warn = place === "TOP";
	const right = `${marker(locale, place, "RIGHT")}${warn ? ` ${marker(locale, place, "OPTION_A")}` : ""} café <right> 😀`;
	return `::: write-distractors ${prompt(locale, place)} <script>literal</script> & [TERM]{definition}
answer: ${right}
:: ${marker(locale, place, "LABEL_A")}
option: ${warn ? right : `${marker(locale, place, "OPTION_A")} </script>`}
:: ${marker(locale, place, "LABEL_B")}
option: ${marker(locale, place, "OPTION_B")} déjà
:::
`;
};
export const source = (locale: string) => `---
title: Practice ${locale}
lang: ${locale}
---
# Practice ${locale}

Read [PUBLIC_TERM]{Public definition.} and assets/public.txt.

${activity(locale, "TOP")}
${[
	["accordion", "ACC"],
	["tabs", "TAB"],
	["sequence", "SEQ"],
	["columns", "COL"],
]
	.map(([type, place]) => `::: ${type}\n:: Public panel\n${activity(locale, place)}:::\n`)
	.join("\n")}
::: cards
:: Public card
${activity(locale, "FRONT")}::: back
${activity(locale, "BACK")}:::
:::
`;
