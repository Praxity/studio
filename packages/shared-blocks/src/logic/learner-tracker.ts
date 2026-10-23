export type LearnerMetric = "grade" | "progress" | "visitCount" | "timeOn";
export type LearnerScope = "course" | "lesson" | "page";

interface LearnerTrackerConfig {
	pageId: string;
	runtime: {
		getSuspendData: () => string | null;
		setSuspendData: (data: string) => void;
		commit: () => void;
		getValue?: (key: string) => string | null;
	};
}

export class LearnerTracker {
	private pageVisitCount = 0;
	private pageTimeStart = Date.now();
	private persistKey = "learnerTracking";

	constructor(private config: LearnerTrackerConfig) {
		this.restore();
	}

	recordPageVisit(): void {
		this.pageVisitCount++;
		this.persist();
	}

	getMetric(metric: LearnerMetric, scope: LearnerScope): number | undefined {
		// Page-level metrics (available in all environments)
		if (scope === "page" && metric === "visitCount") return this.pageVisitCount;
		if (scope === "page" && metric === "timeOn")
			return Math.floor((Date.now() - this.pageTimeStart) / 1000);

		// Course-level visit count: sum all persisted page visits
		if (scope === "course" && metric === "visitCount") {
			return this.getTotalVisitCount();
		}

		// Course-level SCORM metrics
		if (scope === "course" && this.config.runtime.getValue) {
			if (metric === "grade") {
				const raw = this.config.runtime.getValue("cmi.core.score.raw");
				return raw ? Number.parseFloat(raw) : undefined;
			}
			if (metric === "progress") {
				const status = this.config.runtime.getValue("cmi.core.lesson_status") ?? "";
				if (status === "completed" || status === "passed") return 100;
				return 0;
			}
			if (metric === "timeOn") {
				const time = this.config.runtime.getValue("cmi.core.session_time");
				return time ? this.parseScormTime(time) : undefined;
			}
		}

		// Lesson-level and other unsupported metrics
		return undefined;
	}

	private getTotalVisitCount(): number {
		try {
			const data = JSON.parse(this.config.runtime.getSuspendData() || "{}");
			const tracking = data[this.persistKey];
			if (!tracking || typeof tracking !== "object") return this.pageVisitCount;
			let total = 0;
			for (const pageId of Object.keys(tracking)) {
				total += tracking[pageId]?.visitCount ?? 0;
			}
			return total;
		} catch {
			return this.pageVisitCount;
		}
	}

	private parseScormTime(time: string): number {
		// SCORM time format: HH:MM:SS or HH:MM:SS.SS
		const parts = time.split(":");
		if (parts.length < 3) return 0;
		const hours = Number.parseInt(parts[0], 10) || 0;
		const minutes = Number.parseInt(parts[1], 10) || 0;
		const seconds = Number.parseFloat(parts[2]) || 0;
		return hours * 3600 + minutes * 60 + Math.floor(seconds);
	}

	private persist(): void {
		try {
			const existing = JSON.parse(this.config.runtime.getSuspendData() || "{}");
			if (!existing[this.persistKey]) existing[this.persistKey] = {};
			existing[this.persistKey][this.config.pageId] = {
				visitCount: this.pageVisitCount,
			};
			this.config.runtime.setSuspendData(JSON.stringify(existing));
			this.config.runtime.commit();
		} catch {
			// Ignore persist errors
		}
	}

	private restore(): void {
		try {
			const data = JSON.parse(this.config.runtime.getSuspendData() || "{}");
			const pageData = data[this.persistKey]?.[this.config.pageId];
			if (pageData) {
				this.pageVisitCount = pageData.visitCount ?? 0;
			}
		} catch {
			// Ignore corrupt data
		}
	}
}
