"use client";

import { ActionIcon, ColorPicker, Popover } from "@mantine/core";
import { colorToHex, parseOpaqueColor } from "@praxity/shared-blocks/color-math";
import { IconColorPicker } from "@tabler/icons-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import styles from "./panel-color-field.module.css";

interface PanelColorFieldProps {
	value: string;
	onChange: (hex: string) => void;
	label?: string;
}

export function PanelColorField({ value, onChange, label }: PanelColorFieldProps) {
	const t = useTranslations("blocks.panelChrome");
	const [opened, setOpened] = useState(false);
	const [hexInput, setHexInput] = useState(value);
	const [error, setError] = useState<"alpha" | "invalid" | null>(null);
	const errorId = useId();
	const [hasEyeDropper, setHasEyeDropper] = useState(false);
	const swatchRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		setHasEyeDropper("EyeDropper" in window);
	}, []);

	useEffect(() => {
		setHexInput(value);
		setError(null);
	}, [value]);

	const handleClose = useCallback(() => {
		setOpened(false);
		requestAnimationFrame(() => swatchRef.current?.focus());
	}, []);

	const handleHexBlur = useCallback(() => {
		const parsed = parseOpaqueColor(hexInput);
		setError(parsed.error);
		if (parsed.hex) {
			onChange(parsed.hex);
			setHexInput(parsed.hex);
			return;
		}
	}, [hexInput, onChange]);

	const handleEyeDropper = useCallback(async () => {
		try {
			// @ts-expect-error EyeDropper API is not available in all TS libs
			const dropper = new EyeDropper();
			const result = await dropper.open();
			if (result?.sRGBHex) {
				setHexInput(result.sRGBHex);
				onChange(result.sRGBHex);
			}
		} catch {
			// User cancelled or API unavailable
		}
	}, [onChange]);

	return (
		<div className={styles.field}>
			<div className={styles.root}>
				<Popover opened={opened} onChange={setOpened} position="bottom-start" trapFocus>
					<Popover.Target>
						<button
							type="button"
							className={styles.swatch}
							style={{ backgroundColor: value }}
							onClick={() => setOpened((prev) => !prev)}
							ref={swatchRef}
							aria-label={label ? t("pickColorFor", { label }) : t("pickColor")}
						/>
					</Popover.Target>
					<Popover.Dropdown>
						<div
							role="dialog"
							aria-modal={false}
							aria-label={label ? t("colorPickerFor", { label }) : t("colorPicker")}
							className={styles.pickerDialog}
						>
							<ColorPicker
								format="hex"
								value={colorToHex(hexInput) ?? value}
								onChange={(color) => {
									setHexInput(color);
									setError(null);
									onChange(color);
								}}
								size="sm"
							/>
							{hasEyeDropper ? (
								<div className={styles.pickerActions}>
									<ActionIcon
										variant="subtle"
										size="sm"
										onClick={handleEyeDropper}
										aria-label={t("pickColorFromScreen")}
									>
										<IconColorPicker size={16} />
									</ActionIcon>
								</div>
							) : null}
						</div>
					</Popover.Dropdown>
				</Popover>
				<input
					type="text"
					className={styles.hexInput}
					value={hexInput}
					onChange={(event) => {
						setHexInput(event.currentTarget.value);
						setError(null);
					}}
					onBlur={handleHexBlur}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.currentTarget.blur();
						}
						if (event.key === "Escape") {
							setHexInput(value);
							setError(null);
							handleClose();
						}
					}}
					aria-label={label ? t("hexColorValueFor", { label }) : t("hexColorValue")}
					aria-invalid={Boolean(error)}
					aria-describedby={error ? errorId : undefined}
				/>
			</div>
			{error ? (
				<p id={errorId} className={styles.error}>
					{t(error === "alpha" ? "colorAlphaUnsupported" : "colorInvalid")}
				</p>
			) : null}
		</div>
	);
}
