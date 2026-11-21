export interface ActivityEffectTicket {
	revision: number;
	current(): boolean;
}

interface ActivityEffectsDependencies<State> {
	current(): boolean;
	disposed(): boolean;
	activities(): Iterable<string>;
	snapshot(): State;
	write(activityId: string): void;
	writeFailed(activityId: string): void;
	project(ticket: ActivityEffectTicket): void;
	published(state: State): void;
}

export function createActivityEffects<Command, State>(
	dependencies: ActivityEffectsDependencies<State>,
) {
	const jobs: (() => void)[] = [],
		settlements: (() => void)[] = [],
		dirty = new Set<string>(),
		listeners = new Set<(s: State, t: ActivityEffectTicket, c?: Command) => void>();
	let draining = false,
		revision = 0,
		intent = 0,
		changed = false,
		lastCommand: Command | undefined;
	const ticket = (): ActivityEffectTicket => {
		const r = revision,
			i = intent;
		return {
			revision: r,
			current: () => r === revision && i === intent && dependencies.current(),
		};
	};
	const commit = (command?: Command, activityId?: string) => {
		++revision;
		changed = true;
		lastCommand = command;
		if (activityId !== undefined) dirty.add(activityId);
		return ticket();
	};
	const surface = (error: unknown) => {
		const reporter = globalThis.reportError;
		if (reporter) reporter(error);
		else
			queueMicrotask(() => {
				throw error;
			});
	};
	const publish = () => {
		const pass = ticket();
		if (!pass.current()) return;
		for (const activityId of dependencies.activities()) {
			if (dependencies.disposed() || !dirty.has(activityId)) continue;
			dirty.delete(activityId);
			try {
				dependencies.write(activityId);
			} catch {
				if (pass.current()) dependencies.writeFailed(activityId);
			}
			if (!pass.current()) return;
		}
		if (!dependencies.disposed()) dependencies.project(pass);
		if (!pass.current()) return;
		const value = dependencies.snapshot(),
			command = lastCommand;
		changed = false;
		lastCommand = undefined;
		for (const listener of listeners) {
			if (!pass.current()) return;
			try {
				listener(value, pass, command);
			} catch (error) {
				surface(error);
			}
			if (!pass.current()) return;
		}
		dependencies.published(value);
		if (dependencies.disposed()) listeners.clear();
	};
	const drain = () => {
		if (draining) return;
		draining = true;
		try {
			while (jobs.length || changed) {
				while (jobs.length) jobs.shift()?.();
				if (changed) publish();
				if (!dependencies.current() && !jobs.length) break;
			}
		} finally {
			draining = false;
			for (const settle of settlements.splice(0)) settle();
		}
	};
	const enqueue = (job: () => void, invalidate = true) => {
		if (invalidate) {
			++intent;
			changed = true;
		}
		jobs.push(job);
		drain();
	};
	return {
		ticket,
		activityTicket(scope: () => boolean): ActivityEffectTicket {
			return { revision, current: () => dependencies.current() && scope() };
		},
		commit,
		enqueue,
		append(job: () => void) {
			jobs.push(job);
		},
		settle(job: () => void) {
			settlements.push(job);
		},
		get busy() {
			return draining || jobs.length > 0;
		},
		refresh() {
			enqueue(() => {
				changed = true;
			}, false);
		},
		clearWrites() {
			dirty.clear();
		},
		subscribe(listener: (s: State, t: ActivityEffectTicket, c?: Command) => void) {
			listeners.add(listener);
			enqueue(() => {
				const pass = ticket();
				if (pass.current())
					try {
						listener(dependencies.snapshot(), pass);
					} catch (error) {
						surface(error);
					}
			}, false);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
