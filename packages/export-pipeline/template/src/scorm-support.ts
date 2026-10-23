import {
	configureSessionOutcome,
	getSessionState,
	readSessionState,
	sessionAllowsCalls,
	withGroupObjectiveState,
	writeScormSuspendData,
	writeSessionState,
} from "../../src/scorm/api/session";
import { findScormApi, findWindowProperty, readScormEntry } from "../../src/scorm/api-discovery";
import { CourseTracker } from "../../src/scorm/tracking";

// The shell imports launch-reset helpers itself. Export only what the host proxy consumes.
const support = {
	configureSessionOutcome,
	getSessionState,
	readSessionState,
	sessionAllowsCalls,
	withGroupObjectiveState,
	writeScormSuspendData,
	writeSessionState,
	findScormApi,
	findWindowProperty,
	readScormEntry,
	CourseTracker,
};

// Each SCO loads the same owners; session.ts shares records by LMS API identity.
(window as Window & { __praxityScormSupport?: typeof support }).__praxityScormSupport = support;
