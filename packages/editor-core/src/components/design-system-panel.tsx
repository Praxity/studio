"use client";

import { Button, Group, Image, Radio, Slider, Stack, Text, VisuallyHidden } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { DeckDesign, DesignVariants } from "@praxity/grammar";
import {
	canonicalComponentDefaults,
	collectTypographyFontFaces,
	FONT_LIST,
	getManifest,
	getNavPreset,
	getOptionValue,
	isOptionImplemented,
	NAV_PRESET_KEYS,
	normalizeTypography,
	resolveCoursePresetId,
	resolveDeckDesign,
} from "@praxity/grammar";
import { toNavArchetype } from "@praxity/grammar/src/nav-archetype-layout.ts";
import {
	IconAlertTriangle,
	IconCheck,
	IconDeviceDesktop,
	IconMoon,
	IconPhoto,
	IconRefresh,
	IconSun,
	IconTrash,
} from "@tabler/icons-react";
import { type CSSProperties, useEffect, useId, useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { getContrastRatio } from "../lib/a11y/contrast";
import { DEFAULT_DESIGN_VARIANTS } from "../lib/themes/design-variant-defaults";
import { resolvePalette } from "../lib/themes/design-variants-to-css";
import { loadFont } from "../lib/themes/load-font";
import {
	DESIGN_NUMBER_RANGES,
	designNumberControlValue,
} from "../lib/themes/normalize-design-variants";
import {
	accentDriftIndicator,
	findCompliantAccent,
	oklchToSrgb,
	srgbToOklch,
} from "../lib/themes/oklch";
import {
	THEME_PRESET_ACCENT_COUNT,
	THEME_PRESET_DEFAULTS,
	type ThemePresetId,
} from "../lib/themes/theme-preset-defaults";
import styles from "./design-system-panel.module.css";
import { useGrammarDocumentStore } from "./grammar-document-store";
import {
	PanelAccordion,
	PanelColorField,
	PanelField,
	PanelFieldRow,
	PanelIconSelect,
	PanelIconToggle,
	PanelSection,
	PanelShell,
	PanelSwitch,
} from "./panel-chrome";
import { ThemePreviewThumbnail } from "./theme-preview-thumbnail";

const VISIBLE_THEME_PRESET_IDS: ThemePresetId[] = ["ink", "forest", "plum", "clay", "clear"];
const EMPTY_THEME_OVERRIDES = {};

const FONT_OPTIONS = FONT_LIST;

function loadTypographyFontPreviews(): void {
	for (const entry of FONT_OPTIONS) {
		loadFont({ entry, weights: [400], styles: ["normal"] }, "swap");
	}
}

function normalizeHue(hue: number): number {
	if (!Number.isFinite(hue)) return 0;
	const normalized = Math.round(hue) % 360;
	return normalized < 0 ? normalized + 360 : normalized;
}

function normalizeHexColor(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const match = /^#([0-9a-fA-F]{6})$/.exec(value.trim());
	if (!match) return null;
	return `#${match[1].toLowerCase()}`;
}

interface DesignSystemPanelProps {
	moduleDeck?: boolean;
	courseDeck?: DeckDesign;
	courseDesign?: Record<string, unknown>;
	onModuleDeckChange?: (enabled: boolean, defaults: Partial<DesignVariants>) => void;
	onCourseDesignChange?: (partial: Partial<DesignVariants>) => void;
	transformImageUrl?: (url: string) => string;
	onDesktopLogoUpload?: () => Promise<string | null>;
}

export function DesignSystemPanel({
	moduleDeck = false,
	courseDeck,
	courseDesign,
	onModuleDeckChange,
	onCourseDesignChange,
	onDesktopLogoUpload,
	transformImageUrl,
}: DesignSystemPanelProps = {}) {
	const t = useTranslations("editor.designSystem");
	const tGrammar = useTranslations("session.labels");
	const variants = useGrammarDocumentStore((s) => s.designVariants);
	const numberDiagnostics = useGrammarDocumentStore((s) => s.designNumberDiagnostics);
	const [presentationScope, setPresentationScope] = useState<"course" | "module">(
		onCourseDesignChange ? "course" : "module",
	);
	const editingCourse = Boolean(onCourseDesignChange) && presentationScope === "course";
	const presentationVariants: Partial<DesignVariants> = editingCourse ? {} : variants;
	const deck = resolveDeckDesign({ ...courseDeck, ...presentationVariants.deck });
	const authoredDeck = (editingCourse ? courseDeck : presentationVariants.deck) ?? {};
	const updatePresentation = (partial: Partial<DesignVariants>) => {
		if (editingCourse) onCourseDesignChange?.(partial);
		else updateDesignVariants(partial);
	};
	const updateDeck = (partial: Partial<DeckDesign>) =>
		updatePresentation({ deck: { ...authoredDeck, ...partial, preset: "custom" } });
	const updateDesignVariants = useGrammarDocumentStore((s) => s.updateDesignVariants);
	const baseId = useId();
	const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
	const buildFieldId = (suffix: string) => `${baseId}-${suffix}`;
	const numberDiagnostic = (key: keyof typeof DESIGN_NUMBER_RANGES) => {
		const diagnostic = numberDiagnostics.find((entry) => entry.key === key);
		if (!diagnostic) return null;
		const { storedValue, value, reason } = diagnostic;
		const stored =
			storedValue === null || ["string", "number", "boolean"].includes(typeof storedValue)
				? String(storedValue)
				: typeof storedValue;
		const resolved =
			key === "headingSize"
				? t("headingSizeValue", { value })
				: key === "accentHue"
					? t("hueValue", { value })
					: String(value);
		return (
			<Text
				component="span"
				id={buildFieldId(`${key}-diagnostic`)}
				size="xs"
				style={{ overflowWrap: "anywhere" }}
			>
				{t(reason === "notNumber" ? "savedNumberInvalid" : "savedNumberOutOfRange", {
					stored,
					value: resolved,
					min: DESIGN_NUMBER_RANGES[key].min,
					max: DESIGN_NUMBER_RANGES[key].max,
				})}
			</Text>
		);
	};
	const numberDescriptionId = (key: keyof typeof DESIGN_NUMBER_RANGES) =>
		numberDiagnostics.some((entry) => entry.key === key)
			? buildFieldId(`${key}-diagnostic`)
			: undefined;

	const canonicalDefaults = useMemo(
		() => canonicalComponentDefaults(variants.componentDefaults) as Record<string, unknown>,
		[variants.componentDefaults],
	);
	const manifest = getManifest();
	const keywordsWithVariants = useMemo(
		() =>
			Array.from(manifest.values()).filter(
				// Fill-blank modes change answer syntax and need question-specific choices.
				(entry) =>
					entry.variants.length > 0 && entry.layer !== "content" && entry.keyword !== "fill-blank",
			),
		[manifest],
	);

	const backgroundLight = variants.colorBackgroundLight ?? variants.colorBackground ?? "#faf9f7";
	const backgroundDark = variants.colorBackgroundDark ?? "#111827";
	const isPreviewDark =
		variants.colorMode === "dark" || (variants.colorMode === "auto" && prefersDark);
	const accentLight = findCompliantAccent(variants.accentHue, backgroundLight);
	const accentDark = findCompliantAccent(variants.accentHue, backgroundDark);
	const accentHex = resolvePalette(variants, isPreviewDark).colorAccent;
	const primaryAccentAdjusted =
		Math.max(
			accentDriftIndicator(oklchToSrgb(0.48, 0.16, variants.accentHue), accentLight),
			accentDriftIndicator(oklchToSrgb(0.72, 0.14, variants.accentHue), accentDark),
		) > 0.2;

	useEffect(() => {
		for (const request of collectTypographyFontFaces(variants.typography)) {
			loadFont(request, variants.typography.fontDisplay);
		}
	}, [variants.typography]);

	const themeValue = resolveCoursePresetId(variants.palette);
	const themePresetIds = VISIBLE_THEME_PRESET_IDS.includes(themeValue)
		? VISIBLE_THEME_PRESET_IDS
		: [...VISIBLE_THEME_PRESET_IDS, themeValue];
	const presetDefaults = THEME_PRESET_DEFAULTS[themeValue];
	const presetAccentCount = THEME_PRESET_ACCENT_COUNT[themeValue];
	const presentationKeys = [
		...NAV_PRESET_KEYS,
		"navLayout",
		"navArchetype",
		"navArchetypeBase",
		"glossaryPage",
		"deck",
	] as const;

	const isThemeCustomized = Object.entries(presetDefaults).some(
		([key, value]) =>
			!presentationKeys.some((presentationKey) => presentationKey === key) &&
			JSON.stringify(variants[key as keyof typeof variants]) !== JSON.stringify(value),
	);

	const activeAccentCount =
		1 + (variants.colorSecondary != null ? 1 : 0) + (variants.colorTertiary != null ? 1 : 0);
	const isAccentCustomized =
		normalizeHue(variants.accentHue) !==
			normalizeHue(presetDefaults.accentHue ?? variants.accentHue) ||
		activeAccentCount !== presetAccentCount ||
		normalizeHexColor(variants.colorSecondary) !==
			normalizeHexColor(presetDefaults.colorSecondary) ||
		normalizeHexColor(variants.colorTertiary) !== normalizeHexColor(presetDefaults.colorTertiary);
	const isBackgroundCustomized =
		normalizeHexColor(backgroundLight) !== normalizeHexColor(presetDefaults.colorBackgroundLight) ||
		normalizeHexColor(backgroundDark) !== normalizeHexColor(presetDefaults.colorBackgroundDark);
	const isTypographyCustomized =
		JSON.stringify(variants.typography) !== JSON.stringify(presetDefaults.typography) ||
		variants.headingSize !== presetDefaults.headingSize ||
		variants.lineHeight !== presetDefaults.lineHeight;
	const customDimensions = [
		isAccentCustomized ? t("customDimensionAccents") : null,
		isBackgroundCustomized ? t("customDimensionBackgrounds") : null,
		isTypographyCustomized ? t("customDimensionTypography") : null,
	].filter((value): value is string => value != null);

	const updateBackgroundLight = (value: string) => {
		updateDesignVariants({
			colorBackgroundLight: value,
			colorBackground: variants.colorMode === "dark" ? backgroundDark : value,
		});
	};

	const updateBackgroundDark = (value: string) => {
		updateDesignVariants({
			colorBackgroundDark: value,
			colorBackground: variants.colorMode === "dark" ? value : backgroundLight,
		});
	};
	const updateAccentHue = (hue: number) => {
		const colorAccent = findCompliantAccent(hue, backgroundLight);
		updateDesignVariants({
			accentHue: hue,
			accentHueCustomized: true,
			colorAccent,
			colorButtonBackground: colorAccent,
		});
	};

	const applyThemePreset = (presetId: ThemePresetId) => {
		const patch: Partial<DesignVariants> = {
			...THEME_PRESET_DEFAULTS[presetId],
			palette: presetId,
		};
		// Palette and pairing changes preserve authored presentation and inheritance.
		for (const key of presentationKeys) delete patch[key];
		updateDesignVariants(patch);
	};

	// The palette the checker measures, so the panel's contrast readouts and the
	// audit panel can never disagree about what a colour resolves to.
	const statusPalettes = useMemo(
		() => ({ light: resolvePalette(variants, false), dark: resolvePalette(variants, true) }),
		[variants],
	);

	const navArchetype = toNavArchetype(
		presentationVariants.navArchetype ??
			presentationVariants.navLayout ??
			courseDesign?.navArchetype ??
			courseDesign?.navLayout,
	);
	const fallbackArchetype =
		navArchetype === "custom"
			? toNavArchetype(presentationVariants.navArchetypeBase ?? courseDesign?.navArchetypeBase)
			: navArchetype;
	const navPreset = getNavPreset(fallbackArchetype);
	const inheritedSwitch = (
		key:
			| "navFloatingToc"
			| "navKeyboardArrows"
			| "glossaryPage"
			| "navTopBar"
			| "navCourseTitle"
			| "navLessonTitles"
			| "navOutline"
			| "navHamburgerMenu",
		fallback: boolean,
	) =>
		presentationVariants[key] ??
		(typeof courseDesign?.[key] === "boolean" ? courseDesign[key] : fallback);
	const updateNavigation = (partial: Partial<DesignVariants>) =>
		updatePresentation({
			...(navArchetype === "custom"
				? {}
				: { navArchetype: "custom" as const, navArchetypeBase: navArchetype }),
			...partial,
		});
	const outlineOpen = inheritedSwitch("navOutline", navPreset.navOutline);
	const headerShown =
		inheritedSwitch("navTopBar", moduleDeck ? false : navPreset.navTopBar) &&
		inheritedSwitch("navCourseTitle", navPreset.navCourseTitle) &&
		inheritedSwitch("navLessonTitles", navPreset.navLessonTitles);
	const presentationNavDefaults = {
		...getNavPreset(moduleDeck ? "slides" : "sidebar"),
		navTopBar: true,
		navCourseTitle: true,
		navLessonTitles: true,
	};
	const presentationModified =
		!headerShown ||
		Object.entries(presentationNavDefaults).some(
			([key, value]) =>
				(presentationVariants[key as keyof DesignVariants] ??
					courseDesign?.[key] ??
					navPreset[key as keyof typeof navPreset]) !== value,
		) ||
		(moduleDeck
			? !deck.outline ||
				deck.initialPanel !== "closed" ||
				deck.outlineDetail !== "moduleLinks" ||
				!deck.slideCounter
			: fallbackArchetype !== "sidebar");
	const presentationDefaults = (
		guided: boolean,
		currentDeck: DeckDesign,
	): Partial<DesignVariants> => {
		const archetype = guided ? "slides" : "sidebar";
		return {
			...getNavPreset(archetype),
			navArchetype: archetype,
			navArchetypeBase: undefined,
			navTopBar: true,
			navCourseTitle: true,
			navLessonTitles: true,
			...(guided
				? {
						deck: {
							...currentDeck,
							preset: "compact",
							outline: true,
							outlineDetail: "moduleLinks",
							initialPanel: "closed",
							slideCounter: true,
						} as DeckDesign,
					}
				: {}),
		};
	};
	const resetPresentation = () =>
		updatePresentation(presentationDefaults(moduleDeck, authoredDeck));
	const headingSizeOptions = useMemo(() => {
		const values = new Set<string>();
		const { min, max, step } = DESIGN_NUMBER_RANGES.headingSize;
		for (let v = min * 10; v <= max * 10; v += step * 10) {
			values.add(designNumberControlValue(v / 10));
		}
		values.add(designNumberControlValue(variants.headingSize));
		return Array.from(values)
			.sort((a, b) => Number.parseFloat(a) - Number.parseFloat(b))
			.map((value) => ({
				value,
				label: t("headingSizeValue", { value }),
			}));
	}, [t, variants.headingSize]);

	const lineHeightOptions = useMemo(() => {
		const values = new Set<string>();
		const { min, max, step } = DESIGN_NUMBER_RANGES.lineHeight;
		for (let v = min * 10; v <= max * 10; v += step * 10) {
			values.add(designNumberControlValue(v / 10));
		}
		values.add(designNumberControlValue(variants.lineHeight));
		return Array.from(values)
			.sort((a, b) => Number.parseFloat(a) - Number.parseFloat(b))
			.map((value) => ({
				value,
				label: t("lineHeightValue", { value }),
			}));
	}, [t, variants.lineHeight]);

	const themePresetGroupId = buildFieldId("theme-presets");
	const glossaryPageFieldId = buildFieldId("glossary-page");

	const sectionAccordion = (
		<>
			<PanelSection
				title={t("themePresetLabel")}
				first
				action={
					isThemeCustomized ? (
						<Button
							variant="subtle"
							size="xs"
							leftSection={<IconRefresh size={14} />}
							onClick={() => {
								applyThemePreset(themeValue);
								document.getElementById(`${themePresetGroupId}-${themeValue}`)?.focus();
							}}
						>
							{t("reset")}
						</Button>
					) : undefined
				}
			>
				<div className={styles.themeGrid} role="radiogroup" aria-label={t("themePresetLabel")}>
					{themePresetIds.map((presetId) => {
						const selected = themeValue === presetId;
						return (
							// biome-ignore lint/a11y/useSemanticElements: button with role="radio" enables custom themed radio cards with roving keyboard behavior
							<button
								id={`${themePresetGroupId}-${presetId}`}
								key={presetId}
								type="button"
								className={`${styles.themeOption} ${selected ? styles.themeOptionChecked : ""}`}
								onClick={() => applyThemePreset(presetId)}
								onKeyDown={(event) => {
									if (
										event.key !== "ArrowRight" &&
										event.key !== "ArrowDown" &&
										event.key !== "ArrowLeft" &&
										event.key !== "ArrowUp" &&
										event.key !== "Home" &&
										event.key !== "End"
									) {
										return;
									}
									event.preventDefault();
									const currentIndex = themePresetIds.indexOf(presetId);
									const offset = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
									const nextIndex =
										event.key === "Home"
											? 0
											: event.key === "End"
												? themePresetIds.length - 1
												: (currentIndex + offset + themePresetIds.length) % themePresetIds.length;
									const nextPreset = themePresetIds[nextIndex];
									applyThemePreset(nextPreset);
									requestAnimationFrame(() => {
										document.getElementById(`${themePresetGroupId}-${nextPreset}`)?.focus();
									});
								}}
								role="radio"
								aria-checked={selected}
								tabIndex={selected ? 0 : -1}
								aria-label={t(`themePreset.${presetId}`)}
							>
								<span className={styles.themeOptionInner}>
									<span className={styles.themePreviewPair} aria-hidden="true">
										<span className={styles.themeThumbViewport}>
											<span className={styles.themeThumbScale}>
												<ThemePreviewThumbnail
													preset={presetId}
													overrides={EMPTY_THEME_OVERRIDES}
													mode="light"
												/>
											</span>
										</span>
										<span className={styles.themeThumbViewport}>
											<span className={styles.themeThumbScale}>
												<ThemePreviewThumbnail
													preset={presetId}
													overrides={EMPTY_THEME_OVERRIDES}
													mode="dark"
												/>
											</span>
										</span>
									</span>
									<span className={styles.themeLabel}>
										<span className={styles.themeName}>{t(`themePreset.${presetId}`)}</span>
										{selected ? (
											<span className={styles.themeCheck} aria-hidden="true">
												<IconCheck size={13} stroke={2.5} />
											</span>
										) : null}
									</span>
									<span className={styles.themeDescription}>
										{t(`themePresetDescription.${presetId}`)}
									</span>
								</span>
							</button>
						);
					})}
				</div>
				{customDimensions.length > 0 ? (
					<div className={styles.customModeRow}>
						<span className={styles.customModeBadge}>{t("customModeLabel")}</span>
						<span className={styles.customModeText}>{customDimensions.join(" • ")}</span>
					</div>
				) : null}
			</PanelSection>

			<PanelSection title={t("sectionColors")}>
				<PanelField label={t("subDefaultAppearance")}>
					<PanelIconToggle
						value={variants.colorMode}
						onChange={(value) =>
							updateDesignVariants({ colorMode: value as DesignVariants["colorMode"] })
						}
						options={[
							{
								value: "light",
								icon: <IconSun size={16} />,
								label: t("appearanceLight"),
							},
							{
								value: "dark",
								icon: <IconMoon size={16} />,
								label: t("appearanceDark"),
							},
							{
								value: "auto",
								icon: <IconDeviceDesktop size={16} />,
								label: t("appearanceAuto"),
							},
						]}
					/>
				</PanelField>

				<PanelFieldRow>
					<PanelField label={t("subLightBackground")}>
						<PanelColorField
							value={backgroundLight}
							onChange={updateBackgroundLight}
							label={t("subLightBackground")}
						/>
					</PanelField>
					<PanelField label={t("subDarkBackground")}>
						<PanelColorField
							value={backgroundDark}
							onChange={updateBackgroundDark}
							label={t("subDarkBackground")}
						/>
					</PanelField>
				</PanelFieldRow>

				<PanelField
					label={t("subAccentColor")}
					tooltip={primaryAccentAdjusted ? t("accentAdjustedHint") : undefined}
				>
					<PanelColorField
						value={accentHex}
						onChange={(value) => {
							const normalized = /^#/.test(value) ? value : `#${value}`;
							const hue = Math.round(srgbToOklch(normalized).h);
							updateAccentHue(hue);
						}}
						label={t("subAccentColor")}
					/>
				</PanelField>

				<PanelField
					label={t("hueSliderAriaLabel")}
					valueLabel={t("hueValue", { value: variants.accentHue })}
				>
					<Slider
						value={variants.accentHue}
						onChange={updateAccentHue}
						min={DESIGN_NUMBER_RANGES.accentHue.min}
						max={DESIGN_NUMBER_RANGES.accentHue.max}
						step={DESIGN_NUMBER_RANGES.accentHue.step}
						aria-describedby={numberDescriptionId("accentHue")}
						size="xs"
						thumbLabel={t("hueSliderAriaLabel")}
					/>
					{numberDiagnostic("accentHue")}
				</PanelField>

				{/* Status colours sit in Basic → Colors, alongside the other theme
				    colours, because that is where an author looks after the
				    accessibility checker reports "Success on background contrast
				    ratio is …". Until now the checker named colours the panel had no
				    control for. */}
				<div className={styles.statusColorGroup}>
					<p className={styles.statusColorHeading}>{t("subStatusColors")}</p>
					<p className={styles.statusColorHint}>{t("statusColorsDescription")}</p>
					{(
						[
							["subSuccessColor", "colorSuccess", "colorSuccessOnLight", "colorSuccessOnDark"],
							["subErrorColor", "colorError", "colorErrorOnLight", "colorErrorOnDark"],
							["subWarningColor", "colorWarning", "colorWarningOnLight", "colorWarningOnDark"],
						] as const
					).map(([labelKey, paletteKey, lightKey, darkKey]) => (
						<PanelFieldRow key={paletteKey}>
							<StatusColorField
								label={`${t(labelKey)} · ${t("lightMode")}`}
								value={statusPalettes.light[paletteKey]}
								background={statusPalettes.light.colorBackground}
								onChange={(value) => updateDesignVariants({ [lightKey]: value })}
							/>
							<StatusColorField
								label={`${t(labelKey)} · ${t("darkMode")}`}
								value={statusPalettes.dark[paletteKey]}
								background={statusPalettes.dark.colorBackground}
								onChange={(value) => updateDesignVariants({ [darkKey]: value })}
							/>
						</PanelFieldRow>
					))}
				</div>
			</PanelSection>

			<PanelSection title={t("sectionTypography")}>
				<PanelField label={t("fontPairing")} htmlFor={buildFieldId("font-pairing")}>
					<PanelIconSelect
						id={buildFieldId("font-pairing")}
						data={["sans", "book", "clear"].map((id) => ({
							value: id,
							label: t(`pairings.${id}.label`),
						}))}
						value={variants.typography.pairing ?? "sans"}
						onDropdownOpen={loadTypographyFontPreviews}
						onChange={(pairing) => {
							if (pairing)
								updateDesignVariants({
									typography: normalizeTypography({ ...variants.typography, pairing }),
								});
						}}
					/>
					<Text size="sm">{t(`pairings.${variants.typography.pairing ?? "sans"}.help`)}</Text>
				</PanelField>

				<PanelFieldRow>
					<PanelField label={t("subHeadingSize")} htmlFor={buildFieldId("heading-size")}>
						<PanelIconSelect
							id={buildFieldId("heading-size")}
							description={numberDiagnostic("headingSize")}
							data={headingSizeOptions}
							value={designNumberControlValue(variants.headingSize)}
							onChange={(value) => {
								if (!value) return;
								const parsed = Number.parseFloat(value);
								if (!Number.isFinite(parsed)) return;
								updateDesignVariants({ headingSize: parsed });
							}}
						/>
					</PanelField>
					<PanelField label={t("subLineHeight")} htmlFor={buildFieldId("line-height")}>
						<PanelIconSelect
							id={buildFieldId("line-height")}
							description={numberDiagnostic("lineHeight")}
							data={lineHeightOptions}
							value={designNumberControlValue(variants.lineHeight)}
							onChange={(value) => {
								if (!value) return;
								const parsed = Number.parseFloat(value);
								if (!Number.isFinite(parsed)) return;
								updateDesignVariants({ lineHeight: parsed });
							}}
						/>
					</PanelField>
				</PanelFieldRow>
			</PanelSection>

			<PanelSection title={t("sectionBrand")}>
				<div className={styles.logoSlots}>
					<PanelField label={t("brandLight")}>
						<BrandLogoSlot
							logoUrl={variants.brand?.logoUrl}
							previewAlt={t("logoPreviewAlt")}
							uploadLabel={t("uploadLogo")}
							replaceLabel={t("replaceLogo")}
							removeLabel={t("removeLogo")}
							onDesktopUpload={onDesktopLogoUpload}
							transformImageUrl={transformImageUrl}
							onChange={(url) =>
								updateDesignVariants({
									brand: {
										...variants.brand,
										logoUrl: url,
									},
								})
							}
							onRemove={() =>
								updateDesignVariants({
									brand: {
										...variants.brand,
										logoUrl: undefined,
									},
								})
							}
						/>
					</PanelField>
					<PanelField label={t("brandDark")}>
						<BrandLogoSlot
							logoUrl={variants.brand?.logoDarkUrl}
							previewAlt={t("darkLogoPreviewAlt")}
							uploadLabel={t("uploadDarkLogo")}
							replaceLabel={t("replaceDarkLogo")}
							removeLabel={t("removeDarkLogo")}
							onDesktopUpload={onDesktopLogoUpload}
							transformImageUrl={transformImageUrl}
							onChange={(url) =>
								updateDesignVariants({
									brand: {
										...variants.brand,
										logoDarkUrl: url,
									},
								})
							}
							onRemove={() =>
								updateDesignVariants({
									brand: {
										...variants.brand,
										logoDarkUrl: undefined,
									},
								})
							}
							darkPreview
						/>
					</PanelField>
				</div>

				<PanelField label={t("logoScope")} htmlFor={buildFieldId("logo-scope")}>
					<PanelIconSelect
						id={buildFieldId("logo-scope")}
						data={[
							{ value: "sidebar", label: t("logoPlacementSidebar") },
							{ value: "header", label: t("logoPlacementHeader") },
							{ value: "hidden", label: t("logoPlacementHidden") },
						]}
						value={
							variants.brand?.logoPlacement === "sidebar" ||
							variants.brand?.logoPlacement === "hidden"
								? variants.brand.logoPlacement
								: "header"
						}
						onChange={(value) => {
							if (!value) return;
							updateDesignVariants({
								brand: {
									...variants.brand,
									logoPlacement: value as NonNullable<DesignVariants["brand"]>["logoPlacement"],
								},
							});
						}}
					/>
				</PanelField>
			</PanelSection>
		</>
	);

	const presentationAccordion = (
		<Stack gap="lg">
			<Radio.Group
				label={t("presentationFormat")}
				value={moduleDeck ? "guided" : "pages"}
				onChange={(value) => {
					if (!onModuleDeckChange) return;
					onModuleDeckChange(
						value === "guided",
						presentationDefaults(value === "guided", courseDeck ?? {}),
					);
				}}
			>
				<Stack gap="sm" mt="xs">
					<Radio
						value="pages"
						label={t("presentationPages")}
						description={t("presentationPagesHelp")}
						disabled={!onModuleDeckChange}
					/>
					<Radio
						value="guided"
						label={t("presentationGuided")}
						description={t("presentationGuidedHelp")}
						disabled={!onModuleDeckChange}
					/>
				</Stack>
			</Radio.Group>
			{onCourseDesignChange && (
				<Radio.Group
					label={t("presentationScope")}
					value={presentationScope}
					onChange={(value) => setPresentationScope(value === "course" ? "course" : "module")}
				>
					<Group mt="xs">
						<Radio value="course" label={t("presentationCourseScope")} />
						<Radio value="module" label={t("presentationModuleScope")} />
					</Group>
				</Radio.Group>
			)}
			<PanelSection
				title={t(editingCourse ? "presentationCourseScope" : "presentationModuleScope")}
			>
				<Text size="sm" c="dimmed">
					{t(editingCourse ? "presentationCourseScopeHelp" : "presentationModuleScopeHelp")}
				</Text>
				{presentationModified && (
					<Group justify="space-between">
						<Text size="sm" fw={600} role="status">
							{t(moduleDeck ? "presentationGuided" : "presentationPages")} ·{" "}
							{t("presentationModified")}
						</Text>
						<Button
							size="xs"
							variant="subtle"
							onClick={() => {
								resetPresentation();
								document.getElementById(buildFieldId("presentation-initial-panel"))?.focus();
							}}
						>
							{t("presentationReset")}
						</Button>
					</Group>
				)}
				{moduleDeck && (
					<PanelSwitch
						label={t("presentationModuleLinks")}
						checked={deck.outlineDetail === "moduleLinks"}
						onChange={(event) =>
							updateDeck({
								outlineDetail: event.currentTarget.checked ? "moduleLinks" : "currentModule",
							})
						}
					/>
				)}
				{moduleDeck ? (
					<PanelField
						label={t("presentationInitialPanel")}
						htmlFor={buildFieldId("presentation-initial-panel")}
					>
						<PanelIconSelect
							id={buildFieldId("presentation-initial-panel")}
							value={deck.initialPanel}
							data={[
								{ value: "closed", label: t("presentationPanelClosed") },
								{ value: "outline", label: t("presentationPanelOutline") },
								{ value: "transcript", label: t("deckPanel_transcript") },
							]}
							onChange={(value) => {
								if (value === "closed" || value === "outline" || value === "transcript")
									updateDeck({ initialPanel: value, outline: true });
							}}
						/>
					</PanelField>
				) : (
					<PanelSwitch
						id={buildFieldId("presentation-initial-panel")}
						label={t("presentationOutlineOnStart")}
						checked={outlineOpen}
						onChange={(event) =>
							updateNavigation({
								navOutline: event.currentTarget.checked,
								navHamburgerMenu: !event.currentTarget.checked,
							})
						}
					/>
				)}
				{!moduleDeck && (
					<PanelSwitch
						label={t("presentationSections")}
						aria-label={t("presentationSections")}
						description={t("presentationSectionsHelp")}
						checked={inheritedSwitch("navFloatingToc", navPreset.navFloatingToc)}
						onChange={(event) => updateNavigation({ navFloatingToc: event.currentTarget.checked })}
					/>
				)}
				<PanelSwitch
					label={t("presentationHeader")}
					checked={headerShown}
					onChange={(event) =>
						updatePresentation({
							navTopBar: event.currentTarget.checked,
							navCourseTitle: event.currentTarget.checked,
							navLessonTitles: event.currentTarget.checked,
						})
					}
				/>
				<PanelField
					label={t("glossaryPageLabel")}
					tooltip={t("glossaryPageDescription")}
					htmlFor={glossaryPageFieldId}
					direction="row"
				>
					<PanelSwitch
						id={glossaryPageFieldId}
						checked={inheritedSwitch("glossaryPage", true)}
						onChange={(event) => updatePresentation({ glossaryPage: event.currentTarget.checked })}
						aria-label={t("glossaryPageLabel")}
					/>
				</PanelField>
			</PanelSection>
		</Stack>
	);

	const blockDefaultsAccordion = (
		<>
			<PanelSection
				title={t("sectionComponentDefaults")}
				first
				description={t("componentDefaultsHint")}
			>
				{keywordsWithVariants.map((keyword) => {
					const enumAxes = keyword.variants.filter((axis) => axis.type === "enum");
					if (enumAxes.length === 0) return null;

					return enumAxes.map((axis) => {
						const optionEntries = axis.options ?? [];
						const implementedEntries = optionEntries.filter((option) =>
							isOptionImplemented(option),
						);
						const usableEntries = implementedEntries;
						const options = usableEntries.map(getOptionValue);
						if (options.length < 2) return null;
						const blockTypes =
							keyword.keyword === "disclosure" ? ["accordion", "tabs"] : [keyword.keyword];
						const componentDefaults = blockTypes
							.map(
								(blockType) => canonicalDefaults[blockType] as Record<string, unknown> | undefined,
							)
							.find((entry) => entry !== undefined);
						const current = String(
							componentDefaults?.[axis.name] ??
								(axis.name === "style" && ["button", "tabs", "sequence"].includes(keyword.keyword)
									? componentDefaults?.variant
									: undefined) ??
								axis.default ??
								options[0],
						);

						return (
							<PanelField
								key={`${keyword.keyword}-${axis.name}`}
								label={`${tGrammar(`grammar_v4_type_${keyword.keyword}`)} · ${tGrammar(`grammar_v4_setting_${axis.name}`)}`}
								htmlFor={buildFieldId(`component-default-${keyword.keyword}-${axis.name}`)}
							>
								<PanelIconSelect
									id={buildFieldId(`component-default-${keyword.keyword}-${axis.name}`)}
									placeholder={
										current === "default"
											? t("componentDefaultInherited")
											: tGrammar.has(`grammar_v4_value_${axis.name}_${current}`)
												? tGrammar(`grammar_v4_value_${axis.name}_${current}`)
												: t("componentDefaultInherited")
									}
									data={usableEntries.map((option) => {
										const optionValue = getOptionValue(option);
										return {
											value: optionValue,
											label: tGrammar(`grammar_v4_value_${axis.name}_${optionValue}`),
										};
									})}
									value={
										keyword.keyword === "card" &&
										axis.name === "style" &&
										["filled", "shaded", "accent"].includes(current) &&
										["primary", "secondary"].includes(String(componentDefaults?.color))
											? String(componentDefaults?.color)
											: keyword.keyword === "accordion" && !options.includes(current)
												? null
												: keyword.keyword === "card" && current === "accent"
													? "primary"
													: keyword.keyword === "sequence" && current === "plain"
														? "none"
														: keyword.keyword === "card" && current === "filled"
															? "shaded"
															: current
									}
									onChange={(value) => {
										if (!value) return;
										const nextDefaults = { ...canonicalDefaults };
										for (const blockType of blockTypes) {
											nextDefaults[blockType] = {
												...(nextDefaults[blockType] as Record<string, unknown> | undefined),
												[axis.name]: value,
											};
										}
										if (keyword.keyword === "card" && axis.name === "style")
											delete (nextDefaults.card as Record<string, unknown>).color;
										updateDesignVariants({ componentDefaults: nextDefaults });
									}}
								/>
							</PanelField>
						);
					});
				})}
			</PanelSection>
		</>
	);

	return (
		<PanelShell noPadding>
			<PanelAccordion
				sections={[
					{ id: "presentation", label: t("accordionPresentation"), content: presentationAccordion },
					{ id: "theme", label: t("sectionTheme"), content: sectionAccordion },
					{
						id: "blocks",
						label: t("accordionBlockDefaults"),
						content: blockDefaultsAccordion,
					},
				]}
			/>
			<Text
				component="a"
				href="https://github.com/Praxity/prax-format/blob/main/reference/frontmatter-design.md#image-effects"
				target="_blank"
				rel="noreferrer"
				size="xs"
				c="dimmed"
				display="block"
				px="md"
				py="sm"
			>
				{t("moreDesignTokens")}
			</Text>
		</PanelShell>
	);
}

/**
 * WCAG 1.4.3 threshold for normal-sized status text, and the same number
 * `checkContrastPairs` requires of the status colours, so the readout below
 * a swatch says exactly what the accessibility checker would say about it.
 */
const STATUS_COLOR_MIN_RATIO = 4.5;

interface StatusColorFieldProps {
	label: string;
	value: string;
	background: string;
	onChange: (hex: string) => void;
}

function StatusColorField({ label, value, background, onChange }: StatusColorFieldProps) {
	const t = useTranslations("editor.designSystem");
	const ratio = getContrastRatio(value, background);
	const formattedRatio = ratio == null ? null : (Math.round(ratio * 10) / 10).toFixed(1);
	const passes = ratio != null && ratio >= STATUS_COLOR_MIN_RATIO;

	return (
		<PanelField label={label}>
			<PanelColorField value={value} onChange={onChange} label={label} />
			{formattedRatio ? (
				// Verdict is carried by the wording and the icon, not by the colour of
				// the text, so it survives greyscale and colour-vision deficiency.
				<p className={styles.contrastReadout} data-state={passes ? "pass" : "fail"}>
					{passes ? (
						<IconCheck size={13} stroke={2.5} aria-hidden />
					) : (
						<IconAlertTriangle size={13} stroke={2.5} aria-hidden />
					)}
					<span aria-hidden>{formattedRatio}:1</span>
					<VisuallyHidden>
						{passes
							? t("contrastPasses", { ratio: formattedRatio })
							: t("contrastFails", { ratio: formattedRatio })}
					</VisuallyHidden>
				</p>
			) : null}
		</PanelField>
	);
}

interface BrandLogoSlotProps {
	previewAlt: string;
	transformImageUrl?: (url: string) => string;
	logoUrl?: string;
	uploadLabel: string;
	replaceLabel: string;
	removeLabel: string;
	onDesktopUpload?: () => Promise<string | null>;
	onChange: (url: string) => void;
	onRemove: () => void;
	darkPreview?: boolean;
}

function BrandLogoSlot({
	previewAlt,
	transformImageUrl,
	logoUrl,
	uploadLabel,
	replaceLabel,
	removeLabel,
	onDesktopUpload,
	onChange,
	onRemove,
	darkPreview = false,
}: BrandLogoSlotProps) {
	const t = useTranslations("editor.designSystem");
	const [desktopUploading, setDesktopUploading] = useState(false);
	const [desktopError, setDesktopError] = useState<string | null>(null);
	const [failedUrl, setFailedUrl] = useState<string | undefined>();
	const loadErrorId = useId();
	const previewUrl = logoUrl ? (transformImageUrl?.(logoUrl) ?? logoUrl) : undefined;
	const loadFailed = Boolean(previewUrl && failedUrl === previewUrl);
	useEffect(() => {
		setFailedUrl((current) => (current === previewUrl ? current : undefined));
	}, [previewUrl]);

	const handleUploadClick = async () => {
		if (!onDesktopUpload) return;
		setDesktopError(null);
		try {
			setDesktopUploading(true);
			const uploadedPath = await onDesktopUpload();
			if (uploadedPath) {
				setFailedUrl(undefined);
				onChange(uploadedPath);
			}
		} catch (uploadError) {
			setDesktopError(uploadError instanceof Error ? uploadError.message : String(uploadError));
		} finally {
			setDesktopUploading(false);
		}
	};

	return (
		<div>
			<Group gap={8} wrap="nowrap">
				<button
					type="button"
					className={styles.logoPicker}
					data-dark={darkPreview || undefined}
					onClick={() => {
						void handleUploadClick();
					}}
					disabled={desktopUploading || !onDesktopUpload}
					aria-busy={desktopUploading || undefined}
					aria-label={logoUrl ? replaceLabel : uploadLabel}
					aria-describedby={loadFailed ? loadErrorId : undefined}
					title={logoUrl ? replaceLabel : uploadLabel}
				>
					{logoUrl && !loadFailed ? (
						<Image
							key={previewUrl}
							src={previewUrl}
							onError={() => setFailedUrl(previewUrl)}
							alt={previewAlt}
							fit="contain"
							h={24}
						/>
					) : (
						<IconPhoto size={20} aria-hidden />
					)}
				</button>
				{logoUrl ? (
					<Button
						size="xs"
						variant="subtle"
						onClick={onRemove}
						disabled={desktopUploading}
						aria-label={removeLabel}
						title={removeLabel}
						className={styles.logoRemove}
					>
						<IconTrash size={16} aria-hidden />
					</Button>
				) : null}
			</Group>
			{loadFailed ? (
				<Text id={loadErrorId} role="status" size="xs" mt={6}>
					{t("logoLoadError")}
				</Text>
			) : null}

			{desktopError ? (
				<Text size="xs" c="red" mt={6}>
					{desktopError}
				</Text>
			) : null}
		</div>
	);
}
