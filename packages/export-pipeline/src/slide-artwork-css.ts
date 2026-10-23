export const SLIDE_ARTWORK_CSS = `

.praxity-layout-slides #main-content:has(.praxity-slide-canvas) {
	width: 100%;
	padding: 0;
}
.praxity-deck #main-content:has(.praxity-slide-canvas) .deck-slide:has(.praxity-slide-canvas) {
	padding: 0;
}
.praxity-deck
	#main-content:has(.praxity-slide-canvas)
	.deck-slide:not(:has(.praxity-slide-canvas)) {
	padding-inline: max(var(--page-gutter), calc((100% - var(--measure)) / 2));
}
.praxity-slide-canvas {
	container: praxity-slide-canvas / inline-size;
	width: 100%;
	min-width: 0;
	flex: 1 0 auto;
	display: flex;
	flex-direction: column;
	background: var(--slide-bg);
}
.praxity-slide-artwork {
	--corner-gutter: var(--space-6);
	position: relative;
	isolation: isolate;
	flex: 1;
	display: flex;
	flex-direction: column;
	justify-content: var(--slide-align);
	box-sizing: border-box;
	padding-block: var(--section-before);
	padding-inline: max(var(--page-gutter), calc((100% - var(--measure)) / 2));
}
.praxity-layout-slides .praxity-slide-artwork > .praxity-slide {
	min-height: 0;
	flex: 0 0 auto;
	margin-block: 0;
	padding: 0;
	box-shadow: none;
	background: transparent;
}

@supports (container-type: inline-size) and
	(
		(mask-image: linear-gradient(#000, transparent)) or
		(-webkit-mask-image: linear-gradient(#000, transparent))
	) {
	.praxity-slide-artwork::before,
	.praxity-slide-artwork::after {
		content: "";
		z-index: -1;
		background-image: var(--slide-corner-image);
		background-repeat: no-repeat;
		pointer-events: none;
		-webkit-mask-composite: source-in;
		mask-composite: intersect;
	}
	.praxity-slide-artwork::before {
		display: none;
	}

	.praxity-slide-artwork::after {
		position: relative;
		flex: 0 0 auto;
		width: 140px;
		height: 100px;
		margin: var(--space-8) calc(-1 * var(--space-6)) 0 auto;
		background-size: 400px auto;
		background-position: right bottom;
		-webkit-mask-image:
			linear-gradient(to left, #000 75%, transparent),
			linear-gradient(to bottom, transparent, #000 30%, #000 85%, transparent);
		mask-image:
			linear-gradient(to left, #000 75%, transparent),
			linear-gradient(to bottom, transparent, #000 30%, #000 85%, transparent);
	}
	@container praxity-slide-canvas (min-width: 650.01px) {
		.praxity-slide-canvas[data-corner-placement="corners"] .praxity-slide-artwork {
			--corner-gutter: 80px;
		}
		.praxity-slide-canvas[data-corner-placement="corners"] .praxity-slide-artwork::before,
		.praxity-slide-canvas[data-corner-placement="corners"] .praxity-slide-artwork::after {
			display: block;
			position: absolute;
			width: min(
				calc(var(--corner-gutter) - var(--space-6)),
				calc(max(var(--page-gutter), (100cqw - var(--measure)) / 2) - var(--space-6))
			);
			height: 180px;
			margin: 0;
			background-size: 320px auto;
		}
		.praxity-slide-artwork::before {
			left: 0;
			top: 0;
			background-position: left top;
			-webkit-mask-image:
				linear-gradient(to right, #000 80%, transparent),
				linear-gradient(to bottom, #000 85%, transparent);
			mask-image:
				linear-gradient(to right, #000 80%, transparent),
				linear-gradient(to bottom, #000 85%, transparent);
		}
		.praxity-slide-canvas[data-corner-placement="corners"] .praxity-slide-artwork::after {
			right: 0;
			bottom: 0;
			-webkit-mask-image:
				linear-gradient(to left, #000 80%, transparent),
				linear-gradient(to top, #000 85%, transparent);
			mask-image:
				linear-gradient(to left, #000 80%, transparent),
				linear-gradient(to top, #000 85%, transparent);
		}
	}
	@container praxity-slide-canvas (min-width: 850.01px) {
		.praxity-slide-canvas[data-corner-placement="corners"] .praxity-slide-artwork {
			--corner-gutter: clamp(90px, 10cqw, 160px);
		}
		.praxity-slide-canvas[data-corner-placement="corners"] .praxity-slide-artwork::before,
		.praxity-slide-canvas[data-corner-placement="corners"] .praxity-slide-artwork::after {
			height: 280px;
			background-size: 500px auto;
		}
	}
}
:is(.praxity-theme-dark, [data-mantine-color-scheme="dark"])
	.praxity-slide-canvas
	.praxity-slide-artwork::before,
:is(.praxity-theme-dark, [data-mantine-color-scheme="dark"])
	.praxity-slide-canvas
	.praxity-slide-artwork::after {
	display: none;
}
@media print {
	.praxity-slide-canvas[data-corner-placement] .praxity-slide-artwork::before,
	.praxity-slide-canvas[data-corner-placement] .praxity-slide-artwork::after {
		display: none;
	}
}

@supports (forced-color-adjust: auto) {
	@media (forced-colors: active) {
		.praxity-slide-canvas[data-corner-placement] .praxity-slide-artwork::before,
		.praxity-slide-canvas[data-corner-placement] .praxity-slide-artwork::after {
			display: none;
		}
	}
}
`;
