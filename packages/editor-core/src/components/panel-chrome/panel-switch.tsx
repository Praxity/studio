"use client";

import { Switch, type SwitchProps } from "@mantine/core";
import styles from "./panel-switch.module.css";

export type PanelSwitchProps = Omit<SwitchProps, "thumbIcon" | "onLabel" | "offLabel">;

export function PanelSwitch({ size = "md", label, className, ...props }: PanelSwitchProps) {
	return (
		<Switch
			labelPosition="left"
			{...props}
			label={label}
			size={size}
			className={`${styles.root} ${label ? styles.labeled : ""} ${className ?? ""}`}
		/>
	);
}
