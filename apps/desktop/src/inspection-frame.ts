import { startInspectionFrame } from "@praxity/editor-core/frame-bridge";
import { startInspectionPreview } from "@praxity/shared-blocks/course-preview-frame";

// The preview runtime reads the product's URL parameters; the host names the page over its private port.
startInspectionPreview(window, ({ channel, pageId }, parentOrigin) => {
	// The editor bridge needs an exact HTTP parent. A packaged file renderer has none.
	if (parentOrigin !== "null") startInspectionFrame({ window, parentOrigin, channel, pageId });
});
