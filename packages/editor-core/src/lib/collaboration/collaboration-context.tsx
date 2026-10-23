"use client";

import { createContext, useContext } from "react";
import type * as Y from "yjs";

interface CollaborationState {
	ydoc: Y.Doc | null;
	isConnected: boolean;
	isSynced: boolean;
	status?: "connecting" | "connected" | "disconnected";
	isOffline?: boolean;
}

const CollaborationContext = createContext<CollaborationState>({
	ydoc: null,
	isConnected: false,
	isSynced: false,
});

export function useCollaboration() {
	return useContext(CollaborationContext);
}

export { CollaborationContext };
