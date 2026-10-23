"use client";

import { Group, UnstyledButton } from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { AuditFilterMode, DisplaySeverity, SeverityCountMap } from "./types";

interface AuditSeverityFilterProps {
	counts: SeverityCountMap;
	filterMode: AuditFilterMode;
	activeSeverities: Set<DisplaySeverity>;
	onToggleSeverity: (severity: DisplaySeverity) => void;
	onSetDismissedMode: () => void;
	translationNamespace?: string;
	tokenPrefix?: string;
}

const CHIP_ORDER: Array<DisplaySeverity | "dismissed"> = [
	"critical",
	"recommended",
	"minor",
	"dismissed",
];

function getChipToken(type: DisplaySeverity | "dismissed") {
	switch (type) {
		case "critical":
			return "critical";
		case "recommended":
			return "recommended";
		case "minor":
			return "minor";
		default:
			return "dismissed";
	}
}

export function AuditSeverityFilter({
	counts,
	filterMode,
	activeSeverities,
	onToggleSeverity,
	onSetDismissedMode,
	translationNamespace = "a11yAudit",
	tokenPrefix = "--praxity-app-a11y",
}: AuditSeverityFilterProps) {
	const t = useTranslations(translationNamespace);
	const toolbarRef = useRef<HTMLDivElement | null>(null);
	const initialIndex = useMemo(() => {
		if (filterMode === "dismissed") return 3;
		const index = CHIP_ORDER.findIndex(
			(chip) => chip !== "dismissed" && activeSeverities.has(chip),
		);
		return index >= 0 ? index : 0;
	}, [activeSeverities, filterMode]);
	const [rovingIndex, setRovingIndex] = useState(initialIndex);

	useEffect(() => {
		setRovingIndex(initialIndex);
	}, [initialIndex]);

	return (
		<Group
			role="toolbar"
			aria-label={t("filters.toolbarAriaLabel")}
			gap="xs"
			wrap="wrap"
			onKeyDown={(event) => {
				if (
					event.key !== "ArrowRight" &&
					event.key !== "ArrowLeft" &&
					event.key !== "Home" &&
					event.key !== "End"
				) {
					return;
				}

				event.preventDefault();

				let nextIndex = rovingIndex;
				if (event.key === "ArrowRight") {
					nextIndex = (rovingIndex + 1) % CHIP_ORDER.length;
				}
				if (event.key === "ArrowLeft") {
					nextIndex = (rovingIndex - 1 + CHIP_ORDER.length) % CHIP_ORDER.length;
				}
				if (event.key === "Home") {
					nextIndex = 0;
				}
				if (event.key === "End") {
					nextIndex = CHIP_ORDER.length - 1;
				}

				setRovingIndex(nextIndex);
				const toolbar = toolbarRef.current;
				if (!toolbar) {
					return;
				}
				toolbar
					.querySelector<HTMLButtonElement>(`button[data-audit-severity-index="${nextIndex}"]`)
					?.focus();
			}}
			ref={toolbarRef}
		>
			{CHIP_ORDER.map((chip, index) => {
				const token = getChipToken(chip);
				const isDismissedChip = chip === "dismissed";
				const isActive = isDismissedChip
					? filterMode === "dismissed"
					: filterMode === "severity" && activeSeverities.has(chip);
				const isZeroSeverity = !isDismissedChip && counts[chip] === 0;
				const useSeverityColor = isActive && !isZeroSeverity;

				return (
					<UnstyledButton
						key={chip}
						data-audit-severity-index={index}
						type="button"
						tabIndex={rovingIndex === index ? 0 : -1}
						aria-pressed={isActive}
						onClick={() => {
							if (isDismissedChip) {
								onSetDismissedMode();
								return;
							}
							onToggleSeverity(chip);
						}}
						style={{
							padding: "var(--mantine-spacing-xs) var(--mantine-spacing-sm)",
							borderRadius: "var(--mantine-radius-xl)",
							border: `1px solid ${
								useSeverityColor
									? `var(${tokenPrefix}-${token}-chip-border)`
									: "var(--panel-control-border-color)"
							}`,
							background: useSeverityColor
								? `var(${tokenPrefix}-${token}-chip-bg)`
								: "var(--panel-control-bg)",
							color: useSeverityColor
								? `var(${tokenPrefix}-${token}-chip-text)`
								: isZeroSeverity
									? "var(--panel-text-muted)"
									: "var(--panel-text)",
							fontSize: "var(--mantine-font-size-xs)",
							fontWeight: 600,
							cursor: "pointer",
							outline: "none",
						}}
					>
						{t(`severity.${chip}`)} {counts[chip]}
					</UnstyledButton>
				);
			})}
		</Group>
	);
}
