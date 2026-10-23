import type { ChoiceMaterialTree } from "../../src/assessment-choice";

export function rebuild(tree: ChoiceMaterialTree): string {
	const root = document.createElement("div");
	function append(parent: Node, nodes: ChoiceMaterialTree) {
		for (const node of nodes) {
			if (typeof node === "string") parent.appendChild(document.createTextNode(node));
			else {
				const element = document.createElementNS(node[0], node[1]);
				for (const [name, value] of node[2]) element.setAttribute(name, value);
				append(element, node[3]);
				parent.appendChild(element);
			}
		}
	}
	append(root, tree);
	return root.innerHTML;
}

/** Independent application of the documented HTML exemptions. */
export function exemptHtml(html: string) {
	const root = document.createElement("div");
	root.innerHTML = html;
	for (const element of root.querySelectorAll("*")) {
		element.removeAttribute("class");
		element.removeAttribute("style");
		if (
			element.namespaceURI === "http://www.w3.org/1999/xhtml" &&
			["b", "strong", "i", "em", "u", "mark", "span"].includes(element.localName) &&
			!element.attributes.length
		)
			element.replaceWith(...element.childNodes);
	}
	root.normalize();
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		const node = walker.currentNode;
		if (!node.parentElement?.closest("pre,code,textarea"))
			node.textContent = node.textContent?.replace(/[ \t\r\n\f]+/g, " ") ?? "";
	}
	// Block-edge whitespace is collapsible; inline boundaries and preformatted text remain exact.
	const blocks =
		"address,article,aside,blockquote,caption,center,col,colgroup,dd,details,dialog,dir,div,dl,dt,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hgroup,hr,legend,li,main,menu,nav,ol,p,pre,search,section,summary,table,tbody,td,tfoot,th,thead,tr,ul";
	for (const block of [root, ...root.querySelectorAll(blocks)]) {
		if (block.closest("pre,code,textarea")) continue;
		if (block.firstChild?.nodeType === Node.TEXT_NODE)
			block.firstChild.textContent =
				block.firstChild.textContent?.replace(/^[ \t\r\n\f]+/, "") ?? "";
		if (block.lastChild?.nodeType === Node.TEXT_NODE)
			block.lastChild.textContent = block.lastChild.textContent?.replace(/[ \t\r\n\f]+$/, "") ?? "";
		block.normalize();
	}
	// Attribute order is the remaining serialization exemption.
	for (const element of root.querySelectorAll("*")) {
		const attributes = Array.from(element.attributes)
			.map(({ name, value }) => [name, value])
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
		for (const [name, value] of attributes) element.setAttribute(name, value);
	}
	return root.innerHTML;
}
