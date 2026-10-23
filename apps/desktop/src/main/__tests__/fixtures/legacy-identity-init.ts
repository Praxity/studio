import { initializeCourseIdentity, loadIdentityStore } from "../../identity-store.ts";

const root = process.argv[2];
const first = await initializeCourseIdentity(root, ["lesson.prax"]);
const second = await initializeCourseIdentity(root, ["lesson.prax"]);
const store = await loadIdentityStore(root);
process.stdout.write(JSON.stringify({ first, second, store }));
