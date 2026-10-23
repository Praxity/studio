/** Keep naturally compact columns whole and share the rest without splitting words. */
export function allocateTableColumns(
	minimum: readonly number[],
	natural: readonly number[],
	available: number,
	fontSize: number,
): number[] | null {
	const count = natural.length;
	const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
	if (
		count < 2 ||
		minimum.length !== count ||
		!Number.isFinite(available) ||
		!Number.isFinite(fontSize) ||
		fontSize <= 0 ||
		minimum.some(
			(value, index) => !Number.isFinite(value) || value <= 0 || value > natural[index],
		) ||
		natural.some((value) => !Number.isFinite(value)) ||
		// ponytail: conservative 16em per column; revisit only with broader content evidence.
		available < count * 16 * fontSize ||
		sum(natural) <= available ||
		sum(minimum) >= available ||
		!natural.some((value) => value < available / count)
	)
		return null;
	let low = 0;
	let high = Math.max(...natural);
	const widths = (cap: number) =>
		natural.map((value, index) => Math.max(minimum[index], Math.min(value, cap)));
	for (let iteration = 0; iteration < 40; iteration++) {
		const cap = (low + high) / 2;
		if (sum(widths(cap)) > available) high = cap;
		else low = cap;
	}
	return widths(low);
}

const enhanced = new WeakSet<HTMLTableElement>();

/** Enhance the existing semantic table; disposal restores its native layout. */
export function enhanceTableSizing(table: HTMLTableElement): () => void {
	const region = table.parentElement;
	if (!region || enhanced.has(table)) return () => {};
	enhanced.add(table);
	const originalWidth = table.style.width;
	const originalLayout = table.style.tableLayout;
	let columns: HTMLTableColElement | undefined;
	let frame = 0;
	let disposed = false;
	const reset = () => {
		columns?.remove();
		columns = undefined;
		table.style.width = originalWidth;
		table.style.tableLayout = originalLayout;
	};
	const update = () => {
		frame = 0;
		if (disposed) return;
		contentObserver.disconnect();
		reset();
		try {
			const available = region.clientWidth;
			const count = table.rows[0]?.cells.length ?? 0;
			const fontSize = Number.parseFloat(getComputedStyle(table).fontSize);
			if (!available || available < count * 16 * fontSize || count < 2) return;
			// Spanning/ragged authored HTML keeps the browser's native table algorithm.
			if (
				Array.from(table.rows).some(
					(row) =>
						row.cells.length !== count ||
						Array.from(row.cells).some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1),
				)
			)
				return;
			const clone = table.cloneNode(true) as HTMLTableElement;
			clone.removeAttribute("id");
			clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
			clone.setAttribute("aria-hidden", "true");
			clone.inert = true;
			Object.assign(clone.style, {
				position: "absolute",
				visibility: "hidden",
				pointerEvents: "none",
				left: "-20000px",
				top: "0",
				minWidth: "0",
				maxWidth: "none",
				tableLayout: "auto",
			});
			region.append(clone);
			let widths: number[] | null;
			try {
				const measure = (width: string) => {
					clone.style.width = width;
					// Layout widths ignore entrance/ancestor transforms. Allow for integer rounding.
					return Array.from(clone.rows[0].cells, (cell) => cell.offsetWidth + 1);
				};
				widths = allocateTableColumns(
					measure("min-content"),
					measure("max-content"),
					available,
					fontSize,
				);
			} finally {
				clone.remove();
			}
			if (!widths) return;
			columns = document.createElement("colgroup");
			for (const width of widths) {
				const column = document.createElement("col");
				column.style.width = `${width}px`;
				columns.append(column);
			}
			table.insertBefore(columns, table.caption?.nextSibling ?? table.firstChild);
			table.style.tableLayout = "fixed";
			table.style.width = `${available}px`;
		} finally {
			const overflow = region.scrollWidth > region.clientWidth + 1 ? "scroll" : "none";
			if (region.dataset.overflow !== overflow) region.dataset.overflow = overflow;
			contentObserver.observe(table, {
				childList: true,
				subtree: true,
				characterData: true,
				attributes: true,
			});
		}
	};
	const schedule = () => {
		if (!disposed && !frame) frame = requestAnimationFrame(update);
	};
	const decoration = (node: Node) =>
		node instanceof Element && node.closest("svg[data-praxity-doodle-decoration]") !== null;
	const contentObserver = new MutationObserver((mutations) => {
		if (
			mutations.some(
				(mutation) =>
					!decoration(mutation.target) &&
					(mutation.type !== "childList" ||
						[...mutation.addedNodes, ...mutation.removedNodes].some((node) => !decoration(node))),
			)
		)
			schedule();
	});
	const ancestorObserver = new MutationObserver((mutations) => {
		// The overflow cue belongs to this enhancer and cannot change table sizing.
		if (
			mutations.some(
				({ target, attributeName }) => target !== region || attributeName !== "data-overflow",
			)
		)
			schedule();
	});
	for (let ancestor: HTMLElement | null = region; ancestor; ancestor = ancestor.parentElement) {
		ancestorObserver.observe(ancestor, { attributes: true });
	}
	let previousWidth = -1;
	const resizeObserver =
		typeof ResizeObserver === "undefined"
			? null
			: new ResizeObserver(() => {
					if (region.clientWidth === previousWidth) return;
					previousWidth = region.clientWidth;
					schedule();
				});
	resizeObserver?.observe(region);
	window.addEventListener("resize", schedule);
	table.addEventListener("load", schedule, true);
	document.fonts?.addEventListener("loadingdone", schedule);
	void document.fonts?.ready.then(schedule);
	update();
	return () => {
		disposed = true;
		cancelAnimationFrame(frame);
		contentObserver.disconnect();
		ancestorObserver.disconnect();
		resizeObserver?.disconnect();
		window.removeEventListener("resize", schedule);
		table.removeEventListener("load", schedule, true);
		document.fonts?.removeEventListener("loadingdone", schedule);
		reset();
		enhanced.delete(table);
	};
}
