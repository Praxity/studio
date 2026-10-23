"use client";

import { Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useId } from "react";
import { useTranslations } from "use-intl";
import styles from "./panel-field.module.css";

interface PanelFieldProps {
	label: string;
	tooltip?: string;
	htmlFor?: string;
	direction?: "column" | "row";
	valueLabel?: ReactNode;
	children?: ReactNode;
}

export function PanelField({
	label,
	tooltip,
	htmlFor,
	direction = "column",
	valueLabel,
	children,
}: PanelFieldProps) {
	const t = useTranslations("blocks.panelChrome");
	const helpId = useId();

	return (
		<div className={`${styles.root} ${direction === "row" ? styles.rootRow : ""}`}>
			<div className={styles.labelRow}>
				<label className={styles.label} htmlFor={htmlFor}>
					{label}
				</label>
				{tooltip ? (
					<>
						<Tooltip
							label={tooltip}
							multiline
							maw={200}
							events={{ hover: true, focus: true, touch: true }}
						>
							<button
								type="button"
								className={styles.infoButton}
								aria-label={`${label}: ${t("moreInformation")}`}
								aria-describedby={helpId}
							>
								<IconInfoCircle size={14} aria-hidden />
							</button>
						</Tooltip>
						<span id={helpId} className={styles.visuallyHidden}>
							{tooltip}
						</span>
					</>
				) : null}
				{valueLabel ? <span className={styles.valueLabel}>{valueLabel}</span> : null}
			</div>
			{children ?? null}
		</div>
	);
}
