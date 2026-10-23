import { getInlineField } from "../inline-markdown";
import { processMathSpans } from "../math/process-math-spans";
import { sanitizeHtml } from "../sanitize";

/** Display prepared rich text without changing its underlying authored value. */
export function InlineContent({
	owner,
	field,
	interactive = true,
}: {
	owner: unknown;
	field: string | readonly (string | number)[];
	interactive?: boolean;
}) {
	return (
		<span
			// biome-ignore lint/security/noDangerouslySetInnerHtml: authored HTML is sanitized before trusted math rendering
			dangerouslySetInnerHTML={{
				__html: processMathSpans(
					sanitizeHtml(getInlineField(owner, field, interactive), { interactive }),
				),
			}}
		/>
	);
}
