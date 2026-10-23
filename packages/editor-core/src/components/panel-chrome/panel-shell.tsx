"use client";

import type { ReactNode } from "react";
import styles from "./panel-shell.module.css";

interface PanelShellProps {
	children: ReactNode;
	/**
	 * Panel title. Rendered sentence-case as an h2, matching the desktop
	 * right-panel frame headers (Blocks, Design, Publish) so self-headed
	 * panels sit at the same level as framed ones.
	 */
	title?: string;
	header?: ReactNode;
	noPadding?: boolean;
}

export function PanelShell({ children, title, header, noPadding = false }: PanelShellProps) {
	return (
		<div className={`panelChrome ${styles.root}`}>
			{title || header ? (
				<div className={styles.header}>
					{title ? (
						<h2 className={styles.title} data-panel-focus-target tabIndex={-1}>
							{title}
						</h2>
					) : null}
					{header}
				</div>
			) : null}
			<div className={styles.scrollArea}>
				<div
					className={`${styles.content} ${noPadding ? styles.contentNoPadding : ""}`}
					data-panel-content={noPadding ? undefined : "padded"}
				>
					{children}
				</div>
			</div>
		</div>
	);
}
