import { declaredCourseActivityId } from "./activity-id.ts";
import { escapeXml } from "./manifest.ts";

// See docs/context/scorm-xapi-standards.md for spec references

export function generateTincanXml(
	courseId: string,
	courseTitle: string,
	lang: string,
	activityBase?: string,
): string {
	const safeId = escapeXml(declaredCourseActivityId(courseId, activityBase));
	const safeTitle = escapeXml(courseTitle);
	const safeLang = escapeXml(lang || "en");
	return `<?xml version="1.0" encoding="UTF-8"?>
<tincan xmlns="http://projecttincan.com/tincan.xsd">
  <activities>
    <activity id="${safeId}" name="${safeTitle}">
      <launch lang="${safeLang}">index.html</launch>
    </activity>
  </activities>
</tincan>`;
}
