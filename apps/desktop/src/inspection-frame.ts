import { startInspectionFrame } from "@praxity/editor-core/frame-bridge";
import { startInspectionPreview } from "@praxity/shared-blocks/course-preview-frame";

startInspectionPreview(window, ({ channel, pageId }, parentOrigin) => {
	if (parentOrigin !== "null") startInspectionFrame({ window, parentOrigin, channel, pageId });
});
