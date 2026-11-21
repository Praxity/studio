export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}
export interface PopupPlacement {
	left: number;
	top: number;
	width: number;
	maxHeight: number;
	side: "above" | "below" | "left" | "right";
	replaceParent: boolean;
}
export function popupPlacement(options: {
	anchor: Box;
	size: { width: number; height: number };
	viewport: { width: number; height: number };
	hostWidth: number;
	kind: "menu" | "submenu" | "helper";
}): PopupPlacement {
	const { anchor, size, viewport, hostWidth, kind } = options;
	if (
		![
			anchor.left,
			anchor.top,
			anchor.right,
			anchor.bottom,
			size.width,
			size.height,
			viewport.width,
			viewport.height,
			hostWidth,
		].every(Number.isFinite) ||
		size.width <= 0 ||
		size.height <= 0 ||
		viewport.width <= 0 ||
		viewport.height <= 0 ||
		hostWidth <= 0
	)
		throw new Error("Invalid popup geometry");
	const narrow = hostWidth < 600 && kind !== "helper";
	const width = narrow ? Math.max(1, viewport.width - 12) : Math.min(size.width, viewport.width);
	const submenu = kind === "submenu" && !narrow;
	const above = Math.max(0, Math.min(anchor.top - 8, viewport.height));
	const below = Math.max(0, viewport.height - Math.max(0, anchor.bottom + 8));
	const side = submenu
		? viewport.width - anchor.right < 280
			? "left"
			: "right"
		: size.height <= below
			? "below"
			: size.height <= above || above >= below
				? "above"
				: "below";
	const maxHeight = submenu ? viewport.height : side === "above" ? above : below;
	const height = Math.min(size.height, maxHeight);
	const left = narrow
		? Math.min(6, viewport.width - width)
		: submenu
			? side === "left"
				? anchor.left - width + 4
				: anchor.right - 4
			: anchor.left;
	const top = submenu ? anchor.top : side === "above" ? anchor.top - height - 8 : anchor.bottom + 8;
	return {
		left: Math.max(0, Math.min(left, viewport.width - width)),
		top: Math.max(0, Math.min(top, viewport.height - height)),
		width,
		maxHeight,
		side,
		replaceParent: kind === "submenu" && narrow,
	};
}

export function measureOrigins(
	elements: Iterable<HTMLElement>,
	admit: (element: Element, kind: "geometry" | "popup") => void,
	retained?: Map<Element | null, HTMLElement>,
) {
	const probes = new Map<Element | null, HTMLElement>();
	const origins = new Map<Element | null, DOMRect>();
	for (const element of elements) {
		if (probes.has(element.parentElement) || origins.has(element.parentElement)) continue;
		const zoom = element.matches(":popover-open")
			? (element.parentElement as (Element & { currentCSSZoom?: number }) | null)?.currentCSSZoom
			: undefined;
		const win = element.ownerDocument.defaultView;
		if (zoom !== undefined && zoom > 0 && win) {
			origins.set(element.parentElement, new win.DOMRect(0, 0, 100 * zoom, 100 * zoom));
			continue;
		}
		const existing = retained?.get(element.parentElement);
		const probe = existing ?? element.ownerDocument.createElement("span");
		admit(probe, "geometry");
		probe.style.cssText =
			"all:initial!important;position:fixed!important;left:0!important;top:0!important;width:100px!important;height:100px!important;zoom:1!important;visibility:hidden!important;pointer-events:none!important";
		if (!probe.isConnected) element.before(probe);
		if (element.matches(":popover-open")) {
			probe.setAttribute("popover", "manual");
			probe.showPopover();
		}
		probes.set(element.parentElement, probe);
		retained?.set(element.parentElement, probe);
	}
	for (const [parent, probe] of probes) origins.set(parent, probe.getBoundingClientRect());
	for (const probe of probes.values()) {
		if (probe.matches(":popover-open")) probe.hidePopover();
		if (!retained) probe.remove();
	}
	return origins;
}

export function positionFixed(
	element: HTMLElement,
	box: { left: number; top: number; width: number; height: number | "auto"; maxHeight?: number },
	admit: (element: Element, kind: "geometry" | "popup") => void,
	rtl = false,
	origins?: Map<Element | null, DOMRect>,
) {
	const topLayer = element.matches(":popover-open");
	const origin =
		origins?.get(element.parentElement) ??
		measureOrigins([element], admit).get(element.parentElement);
	if (!origin) throw new Error("Invalid chrome containing block");
	const scaleX = origin.width / 100;
	const scaleY = origin.height / 100;
	if (scaleX <= 0 || scaleY <= 0) throw new Error("Invalid chrome containing block");
	const set = (property: string, value: string) => {
		if (
			element.style.getPropertyValue(property) !== value ||
			element.style.getPropertyPriority(property) !== "important"
		)
			element.style.setProperty(property, value, "important");
	};
	if (topLayer) set("zoom", `${1 / scaleX}`);
	const [x, y] = topLayer ? [1, 1] : [scaleX, scaleY];
	const left = (box.left - origin.left) / x;
	set("direction", rtl ? "rtl" : "ltr");
	set(
		"inset-inline-start",
		rtl ? `calc(100% - ${(topLayer ? 0 : left) + box.width / x}px)` : `${topLayer ? 0 : left}px`,
	);
	set("inset-block-start", `${topLayer ? 0 : (box.top - origin.top) / y}px`);
	if (topLayer) {
		set("inset-inline-end", "auto");
		set("inset-block-end", "auto");
		set("translate", `${left}px ${(box.top - origin.top) / y}px`);
	}
	set("width", `${box.width / x}px`);
	set("height", box.height === "auto" ? "auto" : `${box.height / y}px`);
	if (box.maxHeight !== undefined) set("max-height", `${box.maxHeight / y}px`);
}

const geometryProperty =
	/^(?:transform|translate|rotate|scale|zoom|offset(?:Path|Distance|Rotate|Anchor|Position)|(?:min|max)?(?:Width|Height)|width|height|(?:min|max)?(?:InlineSize|BlockSize)|inlineSize|blockSize|top|right|bottom|left|inset.*|margin.*|padding.*|border.*Width|boxSizing|display|position|float|clear|flex.*|grid.*|gap|rowGap|columnGap|columns|columnWidth|columnCount|columnSpan|align.*|justify.*|order|font(?!Palette$).*|lineHeight|letterSpacing|wordSpacing|textIndent|whiteSpace|writingMode|direction|overflow(?!Clip).*|contentVisibility)$/u;

export function observeGeometry(
	doc: Document,
	update: () => void,
	animation?: {
		anchor: () => Element | undefined;
		affects: (target: Element, anchor: Element) => boolean;
	},
) {
	const win = doc.defaultView;
	if (!win) throw new Error("Geometry needs a live document");
	let pending: number | null = null;
	let disposed = false;
	const moving = () => {
		const anchor = animation?.anchor();
		if (!animation || !anchor?.isConnected) return false;
		return doc.getAnimations().some((running) => {
			const effect = running.effect as KeyframeEffect | null;
			return (
				running.playState === "running" &&
				effect?.target instanceof win.Element &&
				animation.affects(effect.target, anchor) &&
				effect
					.getKeyframes()
					.some((frame) => Object.keys(frame).some((key) => geometryProperty.test(key)))
			);
		});
	};
	const schedule = () => {
		if (disposed || pending !== null) return;
		pending = win.requestAnimationFrame(() => {
			pending = null;
			if (!disposed) {
				update();
				if (moving()) schedule();
			}
		});
	};
	const observer =
		typeof win.ResizeObserver === "function" ? new win.ResizeObserver(schedule) : null;
	let observed = new Set<Element>();
	win.addEventListener("scroll", schedule, true);
	win.addEventListener("resize", schedule);
	win.visualViewport?.addEventListener("resize", schedule);
	win.visualViewport?.addEventListener("scroll", schedule);
	const started = (event: Event) => {
		const anchor = animation?.anchor();
		if (
			anchor?.isConnected &&
			event.target instanceof win.Element &&
			animation?.affects(event.target, anchor) &&
			moving()
		)
			schedule();
	};
	if (animation) {
		doc.addEventListener("animationstart", started, true);
		doc.addEventListener("transitionrun", started, true);
	}
	return {
		observe(elements: Iterable<Element>) {
			const next = new Set(elements);
			if (next.size === observed.size && [...next].every((element) => observed.has(element)))
				return;
			observed = next;
			observer?.disconnect();
			for (const element of next) observer?.observe(element);
		},
		schedule,
		dispose() {
			disposed = true;
			observer?.disconnect();
			if (pending !== null) win.cancelAnimationFrame(pending);
			win.removeEventListener("scroll", schedule, true);
			win.removeEventListener("resize", schedule);
			win.visualViewport?.removeEventListener("resize", schedule);
			win.visualViewport?.removeEventListener("scroll", schedule);
			doc.removeEventListener("animationstart", started, true);
			doc.removeEventListener("transitionrun", started, true);
		},
	};
}

export function anchorPopup(options: {
	element: HTMLElement;
	anchor: () => Box;
	hostWidth: () => number;
	kind: "menu" | "submenu" | "helper";
	admit: (element: Element, kind: "geometry" | "popup") => void;
	onPlacement?: (placement: PopupPlacement) => void;
}) {
	const { element, admit } = options;
	const doc = element.ownerDocument;
	const defaultView = doc.defaultView;
	if (!defaultView) throw new Error("Popup needs a live frame");
	const win = defaultView;
	if (new URL(win.location.href).searchParams.get("praxity-inspect") !== "1")
		throw new Error("Popup requires inspection mode");
	admit(element, "popup");
	element.setAttribute("popover", "manual");
	element.showPopover();
	const intrinsic = {
		width: element.style.width,
		height: element.style.height,
		maxHeight: element.style.maxHeight,
	};
	let lastAnchor: Box | null = null;
	function position() {
		element.style.width = intrinsic.width;
		element.style.height = intrinsic.height;
		element.style.maxHeight = intrinsic.maxHeight;
		const size = element.getBoundingClientRect();
		const input = {
			anchor: options.anchor(),
			viewport: {
				width: doc.documentElement.clientWidth || win.innerWidth,
				height: doc.documentElement.clientHeight || win.innerHeight,
			},
			hostWidth: options.hostWidth(),
			kind: options.kind,
		};
		lastAnchor = {
			left: input.anchor.left,
			right: input.anchor.right,
			top: input.anchor.top,
			bottom: input.anchor.bottom,
		};
		const initial = popupPlacement({ ...input, size });
		positionFixed(element, { ...initial, height: size.height }, admit);
		element.style.height = intrinsic.height;
		element.style.maxHeight = intrinsic.maxHeight;
		const placement = popupPlacement({ ...input, size: element.getBoundingClientRect() });
		positionFixed(
			element,
			{
				...placement,
				height: Math.min(element.getBoundingClientRect().height, placement.maxHeight),
			},
			admit,
		);
		options.onPlacement?.(placement);
	}
	const geometry = observeGeometry(doc, position);
	geometry.observe([doc.body, element]);
	position();
	let tracking: number;
	function trackAnchor() {
		const anchor = options.anchor();
		if (
			!lastAnchor ||
			(["left", "right", "top", "bottom"] as const).some((key) => anchor[key] !== lastAnchor?.[key])
		)
			geometry.schedule();
		tracking = win.requestAnimationFrame(trackAnchor);
	}
	tracking = win.requestAnimationFrame(trackAnchor);
	return {
		refresh: position,
		dispose() {
			win.cancelAnimationFrame(tracking);
			geometry.dispose();
			element.hidePopover();
			element.style.width = intrinsic.width;
			element.style.height = intrinsic.height;
			element.style.maxHeight = intrinsic.maxHeight;
		},
	};
}
export function isEditorElementAvailable(element: HTMLElement): boolean {
	const win = element.ownerDocument.defaultView;
	if (!win || !element.isConnected) return false;
	const own = win.getComputedStyle(element).visibility;
	if (own === "hidden" || own === "collapse") return false;
	for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
		if (
			ancestor.hidden ||
			ancestor.inert ||
			ancestor.hasAttribute("inert") ||
			ancestor.getAttribute("aria-hidden") === "true" ||
			win.getComputedStyle(ancestor).display === "none"
		)
			return false;
	}
	return true;
}
