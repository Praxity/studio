# Frozen course inputs

`inputs.json` pins the current leadership course and Rubato smoke fixture for the
modular build equivalence checks. `path` is relative to the repository root;
leadership's actual course is `leadership/course`, below its historical material.
Every file under that course root tracked at the pinned commit is listed once.
No course contents or assets are copied into Studio.

Run from Studio, passing the actual course directory in its Git checkout:

```sh
node scripts/equivalence/verify-inputs.mjs leadership "$SAMPLE_REPO/leadership/course"
node scripts/equivalence/verify-inputs.mjs toolkit "$RUBATO_REPO/fixtures/course"
node --test scripts/equivalence-inputs.test.mjs
```

Hashes describe the frozen **checkout bytes**, including Git's checkout filters.
The clean leadership checkout uses CRLF for source/config, while its committed
blobs use LF. A checkout with different line endings intentionally fails. Copy
verified tracked files byte for byte into fresh scratch directories for builds;
`git archive` alone does not reproduce checkout filters. Do not normalize bytes to
make the check pass. Freeze another baseline explicitly when changing inputs.

The inventory comes from `git ls-tree -r` at the pinned commit. Verification also
uses Git to list cached and extra files, including ignored extras; changed,
missing, extra and unreadable files are named, and a different HEAD fails even
when the file bytes match. Sibling repository files are outside the course scope.
Symlink substitutions are refused. Verification never writes to the course.
`--inputs <manifest.json>` permits small synthetic manifests for verifier tests.

Groups are source (`.prax` and course config), identity (`.praxity/identity/`),
narration (sidecars, audio and VTT), remaining assets, and other tracked files.
Historical identity snapshots are included. Narration files under `assets/` belong
to narration rather than appearing twice.
