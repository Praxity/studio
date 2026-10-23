import { PreviewAssessmentBlock } from "@praxity/shared-blocks/blocks/assessment";
import { admitChoiceStateFacts } from "@praxity/shared-blocks/choice-state-facts";
import { LocaleContext } from "@praxity/shared-blocks/i18n";
import { shouldAttachIslandAutomatically } from "@praxity/shared-blocks/self-check-consumers";
import { MantineIslandProvider } from "@praxity/shared-blocks/viewer/mantine-island-provider";
import { readBasicCourseDeploymentConfig } from "../hosts/course-host";
import { parseBlockJson, readViewerConfig, renderIsland } from "./utils";

const viewerConfig = readViewerConfig();
const config = {
	...viewerConfig,
	...admitChoiceStateFacts(viewerConfig as Record<string, unknown>),
};
const choiceResponseLimit =
	readBasicCourseDeploymentConfig(document)?.format === "scorm12" ? 255 : undefined;

export function attachIsland() {
	const cleanups: (() => void)[] = [];
	document.querySelectorAll<HTMLElement>('[data-island="assessment"]').forEach((el) => {
		const block = parseBlockJson(el);
		if (!block) return;
		if (block.type !== "assessment") {
			return;
		}

		cleanups.push(
			renderIsland(
				el,
				<MantineIslandProvider colorShades={config.colorShades ?? undefined}>
					<LocaleContext.Provider value={config.sourceLocale || "en"}>
						<PreviewAssessmentBlock
							data={block.data as unknown as Parameters<typeof PreviewAssessmentBlock>[0]["data"]}
							blockId={block.id}
							compiledChoiceFacts={
								config.choiceStateQuestions?.[block.id] && config.choiceStateSignatures?.[block.id]
									? {
											question: config.choiceStateQuestions[block.id],
											signature: config.choiceStateSignatures[block.id],
										}
									: undefined
							}
							choiceResponseLimit={choiceResponseLimit}
							reportTitle={el.getAttribute("data-assessment-report-title") ?? undefined}
							groupedDownloadSubmit={el.hasAttribute("data-assessment-group-download-submit")}
						/>
					</LocaleContext.Provider>
				</MantineIslandProvider>,
			),
		);
	});
	return () => cleanups.forEach((cleanup) => cleanup());
}
if (shouldAttachIslandAutomatically()) attachIsland();
