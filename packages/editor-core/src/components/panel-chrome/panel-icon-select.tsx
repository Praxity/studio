"use client";

import { Select } from "@mantine/core";
import type { CSSProperties, ReactNode } from "react";
import styles from "./panel-icon-select.module.css";

interface IconSelectOption {
	value: string;
	label: string;
	icon?: ReactNode;
	labelStyle?: CSSProperties;
}

interface PanelIconSelectProps {
	data: IconSelectOption[];
	value: string | null;
	onChange: (value: string | null) => void;
	placeholder?: string;
	id?: string;
	searchable?: boolean;
	disabled?: boolean;
	maxDropdownHeight?: number | string;
	onDropdownOpen?: () => void;
	"aria-label"?: string;
	description?: ReactNode;
}

export function PanelIconSelect({
	data,
	value,
	onChange,
	placeholder,
	id,
	searchable = false,
	disabled,
	maxDropdownHeight,
	onDropdownOpen,
	"aria-label": ariaLabel,
	description,
}: PanelIconSelectProps) {
	const selected = data.find((option) => option.value === value);
	return (
		<Select
			id={id}
			aria-label={ariaLabel}
			description={description}
			inputWrapperOrder={["input", "description"]}
			data={data.map((d) => ({ value: d.value, label: d.label }))}
			value={value}
			onChange={(nextValue) => onChange(nextValue)}
			placeholder={placeholder}
			searchable={searchable}
			disabled={disabled}
			maxDropdownHeight={maxDropdownHeight}
			onDropdownOpen={onDropdownOpen}
			classNames={{
				root: styles.root,
				input: styles.input,
				dropdown: styles.dropdown,
				option: styles.option,
			}}
			styles={{ input: selected?.labelStyle }}
			renderOption={({ option }) => {
				const match = data.find((d) => d.value === option.value);
				return (
					<div className={styles.optionContent}>
						{match?.icon ? (
							<span className={styles.optionIcon} aria-hidden>
								{match.icon}
							</span>
						) : null}
						<span style={match?.labelStyle}>{option.label}</span>
					</div>
				);
			}}
			comboboxProps={{ withinPortal: false }}
			allowDeselect={false}
		/>
	);
}
