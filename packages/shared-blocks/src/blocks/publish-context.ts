"use client";

import { createContext, useContext } from "react";

interface PublishContextValue {
	tier: "free" | "pro";
}

export const PublishContext = createContext<PublishContextValue | null>(null);

export function usePublishContext(): PublishContextValue | null {
	return useContext(PublishContext);
}
