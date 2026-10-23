"use client";

import { Tooltip } from "@mantine/core";
import { type KeyboardEvent, type ReactNode, useCallback, useRef } from "react";
import styles from "./panel-icon-toggle.module.css";

interface ToggleOption {
	value: string;
	icon: ReactNode;
	label: string;
}

interface PanelIconToggleProps {
	value: string;
	onChange: (value: string) => void;
	options: ToggleOption[];
}

export function PanelIconToggle({ value, onChange, options }: PanelIconToggleProps) {
	const rootRef = useRef<HTMLDivElement | null>(null);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			const currentIndex = options.findIndex((option) => option.value === value);
			let nextIndex = currentIndex;

			if (event.key === "ArrowRight" || event.key === "ArrowDown") {
				event.preventDefault();
				nextIndex = (currentIndex + 1) % options.length;
			} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
				event.preventDefault();
				nextIndex = (currentIndex - 1 + options.length) % options.length;
			} else if (event.key === "Home") {
				event.preventDefault();
				nextIndex = 0;
			} else if (event.key === "End") {
				event.preventDefault();
				nextIndex = options.length - 1;
			} else {
				return;
			}

			onChange(options[nextIndex].value);
			requestAnimationFrame(() => {
				const root = rootRef.current;
				if (!root) {
					return;
				}
				const selector = `button[data-panel-icon-toggle-value="${options[nextIndex].value}"]`;
				root.querySelector<HTMLButtonElement>(selector)?.focus();
			});
		},
		[value, onChange, options],
	);

	return (
		<div ref={rootRef} role="radiogroup" className={styles.root} onKeyDown={handleKeyDown}>
			{options.map((option) => {
				const isSelected = option.value === value;
				return (
					<Tooltip key={option.value} label={option.label} withinPortal={false}>
						<button
							type="button"
							role="radio"
							aria-checked={isSelected}
							aria-label={option.label}
							tabIndex={isSelected ? 0 : -1}
							data-panel-icon-toggle-value={option.value}
							className={`${styles.button} ${isSelected ? styles.selected : ""}`}
							onClick={() => onChange(option.value)}
						>
							<span aria-hidden>{option.icon}</span>
						</button>
					</Tooltip>
				);
			})}
		</div>
	);
}
