import { focusScormResumePage } from "./components/scorm-resume-focus";

// Loaded by the shell only after the host confirms a Pages return. Keep this
// a classic bundle so it has the shell's same LMS and local-file loading rules.
window.__PRAXITY_FOCUS_SCORM_RESUME__ = focusScormResumePage;
