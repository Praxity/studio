import "__praxity_self_check_core__";

const core = window.__praxitySelfCheckCore;
core.entry ??= import.meta.url;

export const initSelfCheckEnhancements = core.initSelfCheckEnhancements;
export const loadSelfCheckAsset = core.loadSelfCheckAsset;
export const disposeSelfCheckDocument = core.disposeSelfCheckDocument;
