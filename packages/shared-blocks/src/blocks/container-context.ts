"use client";

import { createContext } from "react";

export interface ContainerContextValue {
	required: boolean;
	onChildComplete: (blockId: string, options?: { restored?: boolean }) => void;
}

export const ContainerContext = createContext<ContainerContextValue | null>(null);
