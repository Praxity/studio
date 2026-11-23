# Offline image codecs

These notices accompany the WebAssembly image codecs used during local course compilation. The codecs are build resources; they are not copied into exported learner courses.

| Package | Bundled codec source | Source record |
| --- | --- | --- |
| `@jsquash/png` 3.1.1 | Rust `png` 0.17.10 | [jSquash release commit and Cargo.lock](https://github.com/jamsinclair/jSquash/blob/b7fa9ac9ec02f224847ad23d19d115f9e296a368/packages/png/codec/Cargo.lock) |
| `@jsquash/jpeg` 1.6.0 | MozJPEG 3.3.1 | [jSquash release commit and Makefile](https://github.com/jamsinclair/jSquash/blob/1f62015f53e28bd18b2d7c8a3ca3326577efc445/packages/jpeg/codec/Makefile) |
| `@jsquash/webp` 1.5.0 | libwebp `d2e245ea9e959a5a79e1db0ed2085206947e98f2` | [jSquash release commit and Makefile](https://github.com/jamsinclair/jSquash/blob/8bcd212da8c2be7c9c223e8f222eb3d9574a713b/packages/webp/codec/Makefile) |
| `wasm-feature-detect` 1.9.0 | WebAssembly capability check used by jSquash WebP | [package](https://www.npmjs.com/package/wasm-feature-detect/v/1.9.0) |
| `pica` 9.0.1 | JavaScript RGBA resizing | [package](https://www.npmjs.com/package/pica/v/9.0.1) |

The three `jsquash-*-LICENSE` files and `wasm-feature-detect-LICENSE` are copied from the installed npm packages. The `jsquash-*-codec-LICENSE.md` files are copied from the pinned jSquash release commits. The remaining license files are copied from the corresponding pinned upstream source releases. The PNG crate offers MIT or Apache-2.0 terms; both texts are included.

`Rust-dependency-notices.txt` contains the full registry dependency closure from the pinned PNG Cargo.lock, including build-time crates. Each of its 25 crate archives was verified against the lockfile SHA256 before extracting all 53 licence/notice files. Notice line endings are normalized to LF.
