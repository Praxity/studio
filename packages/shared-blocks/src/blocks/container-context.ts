"use client";

import { createContext } from "react";

export interface ContainerContextValue {
	/** Whether the parent container requires this child to be completed. */
	required: boolean;
	/** Child calls this with its blockId when its interaction is complete. */
	onChildComplete: (blockId: string, options?: { restored?: boolean }) => void;
}

export const ContainerContext = createContext<ContainerContextValue | null>(null);
