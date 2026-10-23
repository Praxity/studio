import { MantineProvider } from "@mantine/core";
import { readLesson } from "@praxity/grammar";
import { createRoot } from "react-dom/client";
import { IntlProvider } from "use-intl";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { A11yAuditPanel } from "../../a11y-audit-panel";
import { useGrammarDocumentStore } from "../../grammar-document-store";
import "@mantine/core/styles.css";
import "../../../styles/editor-tokens.css";

const lang = new URLSearchParams(location.search).get("lang") === "fr" ? "fr" : "en";
const grammarSource = `---\ntitle: ${lang === "en" ? "Reading" : "Lecture"}\nlang: ${lang}\n---\n# ${lang === "en" ? "Reading" : "Lecture"}\n::: highlight ${lang === "en" ? "A useful pause" : "Une pause utile"}\n:: ${lang === "en" ? "Give a return time." : "Précisez l'heure du retour."} {key}\n:::\n`;
const read = readLesson(grammarSource);
useGrammarDocumentStore.setState({
	courseId: "support-proof",
	grammarSource,
	parsedBlocks: read.blocks,
	parsedSpans: read.spans,
	frontmatter: read.frontmatter,
	parseError: null,
});
createRoot(document.getElementById("root")!).render(
	<IntlProvider locale={lang} messages={lang === "en" ? en : fr}>
		<MantineProvider>
			<A11yAuditPanel />
		</MantineProvider>
	</IntlProvider>,
);
