import type { ReactNode } from "react";
import styles from "./panel-section.module.css";

interface PanelSectionProps {
	title: string;
	description?: string;
	action?: ReactNode;
	/** Set true for the first section in an accordion to hide the divider */
	first?: boolean;
	children: ReactNode;
}

export function PanelSection({ title, description, action, first, children }: PanelSectionProps) {
	return (
		<div className={styles.root}>
			{!first && <div className={styles.divider} />}
			{action ? (
				<div className={styles.header}>
					<h3 className={styles.heading}>{title}</h3>
					{action}
				</div>
			) : (
				<h3 className={styles.heading}>{title}</h3>
			)}
			{description ? <p className={styles.description}>{description}</p> : null}
			<div className={styles.fields}>{children}</div>
		</div>
	);
}
