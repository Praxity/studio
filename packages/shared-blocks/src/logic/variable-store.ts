export interface VariableDefinition {
	name: string;
	dataType: "number" | "text" | "boolean";
	source?: "manual" | "url_parameter" | "lms" | "computed" | "author";
	defaultValue?: string | number | boolean;
	locked?: boolean;
	urlParamName?: string;
	urlParamFallback?: string | number | boolean;
	lmsField?: string;
	lmsFallback?: string | number | boolean;
}

export class VariableStore {
	private variables: Map<string, string | number | boolean> = new Map();
	private definitions: Map<string, VariableDefinition> = new Map();
	private persistKey: string;
	private legacyPersistKey = "variables";

	constructor(
		defs: VariableDefinition[],
		private runtime: {
			getSuspendData: () => string | null;
			setSuspendData: (data: string) => void;
			commit: () => void;
			getValue?: (key: string) => string | null | undefined;
		},
	) {
		// Compact key for SCORM 1.2 suspend_data headroom.
		this.persistKey = "v";

		// Initialize from definitions
		for (const def of defs) {
			// Backward compat: "author" source is now "computed" + locked
			if ((def as unknown as Record<string, unknown>).source === "author") {
				def.source = "computed";
				def.locked = true;
			}

			this.definitions.set(def.name, def);
			const defaultVal = def.defaultValue ?? this.getTypeDefault(def.dataType);
			this.variables.set(def.name, defaultVal);
		}

		// Initialize from URL parameters (before restore, so suspend_data takes precedence)
		this.initUrlParams();
		for (const def of this.definitions.values()) {
			if (def.source !== "lms" || !def.lmsField) continue;
			const value = this.runtime.getValue?.(def.lmsField);
			if (value !== undefined && value !== null && value !== "")
				this.variables.set(def.name, this.coerce(value, def.dataType));
			else if (def.lmsFallback !== undefined) this.variables.set(def.name, def.lmsFallback);
		}

		// Restore from suspend_data
		this.restore();
	}

	get(name: string): string | number | boolean | undefined {
		return this.variables.get(name);
	}

	getDefinition(name: string): VariableDefinition | undefined {
		return this.definitions.get(name);
	}

	toMap(): Map<string, string | number | boolean> {
		return new Map(this.variables);
	}

	set(name: string, value: string | number | boolean): void {
		const def = this.getDefinition(name);
		if (def?.locked) return; // Locked variables cannot be modified
		this.variables.set(name, value);
		this.persist();
	}

	restoreFromSuspendData(): void {
		this.restore();
	}

	private getTypeDefault(dataType: string): string | number | boolean {
		switch (dataType) {
			case "number":
				return 0;
			case "boolean":
				return false;
			default:
				return "";
		}
	}

	private initUrlParams(): void {
		if (typeof window === "undefined") return; // SSR safety
		try {
			const params = new URLSearchParams(window.location.search);
			for (const [, def] of this.definitions) {
				if (def.source === "url_parameter" && def.urlParamName) {
					const val = params.get(def.urlParamName);
					if (val !== null) {
						this.variables.set(def.name, this.coerce(val, def.dataType));
					} else if (def.urlParamFallback !== undefined) {
						this.variables.set(def.name, def.urlParamFallback);
					}
				}
			}
		} catch {
			// Ignore URL parsing errors
		}
	}

	private coerce(value: string, dataType: string): string | number | boolean {
		switch (dataType) {
			case "number":
				return Number(value) || 0;
			case "boolean":
				return value === "true" || value === "1";
			default:
				return value;
		}
	}

	private persist(): void {
		const compactVariables = this.getPersistableVariables();
		try {
			const existing = JSON.parse(this.runtime.getSuspendData() || "{}");
			if (Object.keys(compactVariables).length === 0) {
				delete existing[this.persistKey];
				delete existing[this.legacyPersistKey];
			} else {
				existing[this.persistKey] = compactVariables;
				delete existing[this.legacyPersistKey];
			}
			const serialized = JSON.stringify(existing);
			if (serialized.length > 3800) {
				console.warn(
					`[logic] Variable suspend_data payload is ${serialized.length} chars; SCORM 1.2 limit is 4096.`,
				);
			}
			this.runtime.setSuspendData(serialized);
			this.runtime.commit();
		} catch {
			// Fallback: write directly
			const data = JSON.stringify({ [this.persistKey]: compactVariables });
			this.runtime.setSuspendData(data);
		}
	}

	private restore(): void {
		try {
			const data = JSON.parse(this.runtime.getSuspendData() || "{}");
			const saved = data[this.persistKey] ?? data[this.legacyPersistKey];
			if (saved && typeof saved === "object") {
				for (const [key, val] of Object.entries(saved)) {
					if (this.variables.has(key)) {
						this.variables.set(key, val as string | number | boolean);
					}
				}
			}
		} catch {
			// Ignore corrupt data
		}
	}

	private getPersistableVariables(): Record<string, string | number | boolean> {
		const persisted: Record<string, string | number | boolean> = {};
		for (const [name, value] of this.variables) {
			const def = this.definitions.get(name);
			const defaultValue = def?.defaultValue ?? this.getTypeDefault(def?.dataType ?? "text");
			if (value === defaultValue) continue;
			persisted[name] = value;
		}
		return persisted;
	}
}
