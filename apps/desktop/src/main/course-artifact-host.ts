import type { CourseArtifactFile } from "@praxity/export-pipeline";
import type { HostedCourseArtifact, HostedCourseDeployment } from "./course-preview-service";
import { ResponseStreamOwner } from "./response-stream";

const COURSE_TOKEN_PATTERN = /^[a-f0-9]{32}$/;
const REVISION_PATTERN = /^[a-f0-9]{64}$/;
interface HostedCourse {
	deployment: HostedCourseDeployment;
	files: ReadonlyMap<string, CourseArtifactFile>;
	references: number;
	streams: ResponseStreamOwner;
	disposePromise?: Promise<void>;
}
export function createCourseArtifactHost(options: {
	entryBaseUrl: (token: string, revision: string) => string;
	resolveIdentity: (
		url: URL,
	) => { courseToken: string; revision: string; relativePath: string } | { status: 400 } | null;
}) {
	const hostedCourses = new Map<string, HostedCourse>();
	function disposeCourse(hosted: HostedCourse): Promise<void> {
		hosted.disposePromise ??= (async () => {
			await hosted.streams.close();
			await hosted.deployment.dispose();
		})();
		return hosted.disposePromise;
	}

	function isSafeArtifactPath(relativePath: string): boolean {
		return (
			relativePath.length > 0 &&
			!relativePath.startsWith("/") &&
			!relativePath.includes("\\") &&
			!relativePath.includes("\0") &&
			relativePath
				.split("/")
				.every((segment) => segment !== "" && segment !== "." && segment !== "..")
		);
	}

	function hostedCourseKey(courseToken: string, revision: string): string {
		return `${courseToken}/${revision}`;
	}

	type CourseUrlResolution =
		| { status: 400 | 403 | 404 }
		| {
				courseKey: string;
				file: CourseArtifactFile;
				hosted: HostedCourse;
				relativePath: string;
		  };

	function resolveCourseUrl(rawUrl: string): CourseUrlResolution {
		let url: URL;
		try {
			url = new URL(rawUrl);
		} catch {
			return { status: 400 };
		}
		const identity = options.resolveIdentity(url);
		if (!identity) return { status: 403 };
		if ("status" in identity) return identity;
		const { courseToken, revision, relativePath } = identity;
		if (!isSafeArtifactPath(relativePath)) return { status: 403 };

		const courseKey = hostedCourseKey(courseToken, revision);
		const hosted = hostedCourses.get(courseKey);
		if (!hosted) return { status: 404 };
		const file = hosted.files.get(relativePath);
		if (!file) return { status: 404 };
		return { courseKey, file, hosted, relativePath };
	}

	function encodeArtifactPath(relativePath: string): string {
		return relativePath.split("/").map(encodeURIComponent).join("/");
	}

	function sameArtifactFiles(
		left: ReadonlyMap<string, CourseArtifactFile>,
		right: ReadonlyMap<string, CourseArtifactFile>,
	): boolean {
		if (left.size !== right.size) return false;
		for (const [filePath, file] of left) {
			const candidate = right.get(filePath);
			if (
				!candidate ||
				candidate.byteLength !== file.byteLength ||
				candidate.sha256 !== file.sha256 ||
				candidate.mediaType !== file.mediaType
			) {
				return false;
			}
		}
		return true;
	}

	function createHostedCourseHandle(
		courseKey: string,
		hosted: HostedCourse,
		entryUrl: string,
	): HostedCourseArtifact {
		let released = false;
		return Object.freeze({
			entryUrl,
			release: async () => {
				if (released) return;
				released = true;
				hosted.references -= 1;
				if (hosted.references > 0) return;
				if (hostedCourses.get(courseKey) === hosted) hostedCourses.delete(courseKey);
				await disposeCourse(hosted);
			},
		});
	}

	async function hostCourseArtifact(
		deployment: HostedCourseDeployment,
	): Promise<HostedCourseArtifact> {
		const { courseToken, manifest } = deployment;
		let files: Map<string, CourseArtifactFile>;
		try {
			if (!COURSE_TOKEN_PATTERN.test(courseToken) || !REVISION_PATTERN.test(manifest.revision)) {
				throw new Error("Course preview deployment identity is invalid.");
			}
			if (!isSafeArtifactPath(manifest.entry)) {
				throw new Error("Course preview entry path is invalid.");
			}
			files = new Map<string, CourseArtifactFile>();
			for (const file of manifest.files) {
				if (
					!isSafeArtifactPath(file.path) ||
					!Number.isSafeInteger(file.byteLength) ||
					file.byteLength < 0 ||
					!/^[a-f0-9]{64}$/.test(file.sha256) ||
					!file.mediaType
				) {
					throw new Error("Course preview manifest contains an invalid file.");
				}
				if (files.has(file.path)) {
					throw new Error("Course preview manifest contains a duplicate file.");
				}
				files.set(file.path, file);
			}
			if (!files.has(manifest.entry)) {
				throw new Error("Course preview entry is missing from the manifest.");
			}
		} catch (error) {
			await deployment.dispose();
			throw error;
		}

		const courseKey = hostedCourseKey(courseToken, manifest.revision);
		const entryUrl = `${options.entryBaseUrl(courseToken, manifest.revision)}${encodeArtifactPath(manifest.entry)}`;
		const existing = hostedCourses.get(courseKey);
		if (existing) {
			if (!sameArtifactFiles(existing.files, files)) {
				await deployment.dispose();
				throw new Error("Course preview revision conflicts with the hosted manifest.");
			}
			existing.references += 1;
			try {
				await deployment.dispose();
			} catch (error) {
				existing.references -= 1;
				throw error;
			}
			return createHostedCourseHandle(courseKey, existing, entryUrl);
		}
		const hosted = { deployment, files, references: 1, streams: new ResponseStreamOwner() };
		hostedCourses.set(courseKey, hosted);
		return createHostedCourseHandle(courseKey, hosted, entryUrl);
	}

	/** Retain an already-hosted revision for a secondary window. */
	function retainHostedCourseArtifact(rawUrl: string): HostedCourseArtifact | null {
		const resolved = resolveCourseUrl(rawUrl);
		if ("status" in resolved) return null;
		resolved.hosted.references += 1;
		return createHostedCourseHandle(resolved.courseKey, resolved.hosted, rawUrl);
	}

	function isAllowedCourseDownload(urlChain: readonly string[]): boolean {
		if (urlChain.length === 0) return false;
		let courseKey: string | undefined;
		for (const rawUrl of urlChain) {
			const resolved = resolveCourseUrl(rawUrl);
			if ("status" in resolved) return false;
			courseKey ??= resolved.courseKey;
			if (resolved.courseKey !== courseKey) return false;
		}
		return true;
	}

	function isAllowedCourseNavigation(
		currentUrl: string,
		targetUrl: string,
		allowInitialNavigation = false,
	): boolean {
		const target = resolveCourseUrl(targetUrl);
		if ("status" in target) return false;
		if (allowInitialNavigation && (currentUrl === "" || currentUrl === "about:blank")) return true;
		const current = resolveCourseUrl(currentUrl);
		return !("status" in current) && current.courseKey === target.courseKey;
	}

	return {
		hostCourseArtifact,
		retainHostedCourseArtifact,
		isAllowedCourseDownload,
		isAllowedCourseNavigation,
		resolveCourseUrl,
		async dispose() {
			const courses = [...hostedCourses.values()];
			hostedCourses.clear();
			await Promise.all(courses.map(disposeCourse));
		},
	};
}
