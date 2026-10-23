import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { expect, it } from "vitest";
import { renderBlockHtml } from "../render-block-html";

it("renders table headers and authored formatting in the canonical artifact", () => {
	const table = {
		id: "table",
		type: "table",
		data: { headers: ["Risk", "After"], rows: [["Monitor", "Raised"]] },
	} as PraxityBlock;
	const html = renderBlockHtml(table);
	expect(html).toContain('class="praxity-data-table"');
	expect(html).toContain('data-gridlines="all"');
	expect(html).toContain('<th scope="col" style="text-align:left">Risk</th>');

	const custom = renderBlockHtml({
		...table,
		data: {
			...table.data,
			highlightHeaderRow: false,
			highlightHeaderCol: true,
			shadeHeaders: false,
			firstRowLine: false,
			gridlines: "columns",
			columnAlignments: ["left", "right"],
		},
	} as PraxityBlock);
	expect(custom).not.toContain("<thead>");
	expect(custom).toContain('<th scope="row" style="text-align:left">Monitor</th>');
	expect(custom).toContain('<td style="text-align:right">Raised</td>');
	expect(custom).toContain('data-gridlines="columns"');
	expect(custom).toContain('data-shade-headers="false"');
	expect(custom).toContain('data-first-row-line="false"');
});

it("does not interpolate untrusted table options into attributes", () => {
	const html = renderBlockHtml({
		id: "table",
		type: "table",
		data: {
			headers: ["Column"],
			rows: [["Value"]],
			shadeHeaders: '" onmouseover="alert(1)',
			firstRowLine: '" onmouseover="alert(1)',
			firstColLine: '" onmouseover="alert(1)',
			striped: '" onmouseover="alert(1)',
			gridlines: '" onmouseover="alert(1)',
		},
	} as unknown as PraxityBlock);
	expect(html).not.toContain("onmouseover");
});
