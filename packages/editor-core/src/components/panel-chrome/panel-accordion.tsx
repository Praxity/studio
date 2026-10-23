"use client";

import { IconChevronDown } from "@tabler/icons-react";
import { type ReactNode, useCallback, useState } from "react";
import styles from "./panel-accordion.module.css";

interface AccordionSection {
	id: string;
	label: string;
	content: ReactNode;
}

interface PanelAccordionProps {
	sections: AccordionSection[];
}

export function PanelAccordion({ sections }: PanelAccordionProps) {
	const [openId, setOpenId] = useState<string | null>(() => sections[0]?.id ?? null);

	const toggle = useCallback((id: string) => {
		setOpenId((prev) => (prev === id ? null : id));
	}, []);

	return (
		<div>
			{sections.map((section) => {
				const isOpen = openId === section.id;
				const panelId = `panel-accordion-panel-${section.id}`;

				return (
					<div key={section.id} className={styles.section}>
						<button
							type="button"
							className={styles.header}
							aria-expanded={isOpen}
							aria-controls={panelId}
							onClick={() => toggle(section.id)}
						>
							{section.label}
							<IconChevronDown
								size={16}
								className={`${styles.chevron} ${isOpen ? styles.chevronOpen : styles.chevronClosed}`}
								aria-hidden
							/>
						</button>
						<div hidden={!isOpen}>
							<div id={panelId} className={styles.content} data-panel-content="padded">
								{section.content}
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}
