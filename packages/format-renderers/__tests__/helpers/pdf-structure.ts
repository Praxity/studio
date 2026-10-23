export interface PdfStructureNode {
	tag: string;
	id?: string;
	title?: string;
	alt?: string;
	reference?: string;
	attributes?: Record<string, string>;
	children: PdfStructureNode[];
}

/** Poppler's two-space nesting is stable; 24.02 omits the newer inline alt field. */
export function parsePdfStructure(output: string): PdfStructureNode {
	const stack: PdfStructureNode[] = [];
	let root: PdfStructureNode | undefined;
	let acceptsAttributes = false;
	for (const [index, line] of output.split(/\r?\n/).entries()) {
		if (!line.trim()) continue;
		const fail: () => never = () => {
			throw new Error(`Invalid PDF structure at line ${index + 1}: ${line}`);
		};
		const indent = line.match(/^ */)?.[0].length ?? 0;
		const content = line.slice(indent);
		const attribute = content.match(/^\/([A-Za-z0-9]+) (.+)$/);
		if (attribute) {
			const owner = stack.at(-1);
			if (!owner || !acceptsAttributes || indent !== (stack.length - 1) * 2 + 3) fail();
			const attributes = (owner.attributes ??= {});
			if (Object.hasOwn(attributes, attribute[1])) fail();
			attributes[attribute[1]] = attribute[2];
			continue;
		}
		if (indent % 2 !== 0) fail();
		const depth = indent / 2;
		if (depth > stack.length) fail();
		const object = content.match(/^Object (\d+ \d+)$/);
		const element = content.match(
			/^([A-Za-z][A-Za-z0-9]*)(?: <([^>]+)>)?(?: "(.*?)")?(?: \["(.*?)"\])?(?: \((?:block|inline)\))?(:)?$/,
		);
		let node: PdfStructureNode;
		if (object) {
			node = { tag: "Object", reference: object[1], children: [] };
		} else if (element) {
			node = {
				tag: element[1],
				...(element[2] !== undefined ? { id: element[2] } : {}),
				...(element[3] !== undefined ? { title: element[3] } : {}),
				// Windows Poppler adds one terminal NUL; keep any authored internal NUL.
				...(element[4] !== undefined ? { alt: element[4].replace(/\u0000$/, "") } : {}),
				children: [],
			};
		} else {
			fail();
		}
		if (depth === 0) {
			if (root || node.tag !== "Document") fail();
			root = node;
		} else {
			const parent = stack[depth - 1];
			if (!parent || parent.tag === "Object") fail();
			parent.children.push(node);
		}
		stack.length = depth;
		stack.push(node);
		acceptsAttributes = element?.[5] === ":";
	}
	if (!root) throw new Error("Empty PDF structure");
	return root;
}

export function structureNodes(tree: PdfStructureNode): PdfStructureNode[] {
	return [tree, ...tree.children.flatMap(structureNodes)];
}
