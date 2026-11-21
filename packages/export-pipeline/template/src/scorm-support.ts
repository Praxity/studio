import {
	commitScormSession,
	getSessionState,
	readSessionState,
	sessionAllowsCalls,
	writeSessionState,
} from "../../src/scorm/api/session";
import { findScormApi, findWindowProperty, readScormEntry } from "../../src/scorm/api-discovery";
import { CourseTracker } from "../../src/scorm/tracking";

const support = {
	getSessionState,
	readSessionState,
	commitScormSession,
	sessionAllowsCalls,
	writeSessionState,
	findScormApi,
	findWindowProperty,
	readScormEntry,
	CourseTracker,
};

(window as Window & { __praxityScormSupport?: typeof support }).__praxityScormSupport = support;
