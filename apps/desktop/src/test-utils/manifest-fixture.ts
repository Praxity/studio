import { planManifestLessons, readCourseManifestData } from "../main/course-manifest-io";
import {
	applyProjectFilePlan,
	withProjectFileTransaction,
} from "../main/project-file-transactions";

export async function writeManifestFixtureLessons(root: string) {
	await withProjectFileTransaction(
		root,
		async () => {
			await applyProjectFilePlan(root, await planManifestLessons(root, () => ["b.prax"]));
		},
		"write",
	);
	return readCourseManifestData(root);
}
