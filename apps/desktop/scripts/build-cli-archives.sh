#!/usr/bin/env bash
set -euo pipefail

# Run from the source checkout's root. The candidate workflow can supply this
# script from its own revision while building an older CLI-capable source ref.
browser_editor=false
if [[ "${1:-}" == --browser-editor ]]; then
  browser_editor=true
  shift
fi
[[ $# -eq 0 ]] || { echo "Usage: $0 [--browser-editor]" >&2; exit 1; }

version="$(node -p "require('./apps/desktop/package.json').version")"
mkdir -p apps/desktop/release
native_arch="$(node -p process.arch)"
case "$native_arch" in
  arm64) arches=(x64 arm64) ;;
  x64) arches=(arm64 x64) ;;
  *) echo "Unsupported native architecture: $native_arch" >&2; exit 1 ;;
esac
for arch in "${arches[@]}"; do
  source_status="$(git status --porcelain)"
  if [[ -n "$source_status" ]]; then
    printf 'Refusing %s CLI build from a dirty source tree:\n%s\n' "$arch" "$source_status" >&2
    exit 1
  fi
  TYPST_ARCH="$arch" pnpm build:cli
  archive="praxity-cli-${version}-macos-${arch}.tar.gz"
  # macOS tar otherwise adds ._* AppleDouble files and xattr headers (com.apple.provenance)
  # that GNU tar warns about.
  COPYFILE_DISABLE=1 tar --no-xattrs -C dist -czf "apps/desktop/release/$archive" studio-cli
  (cd apps/desktop/release && shasum -a 256 --binary "$archive" > "$archive.sha256")
done

# Tests can write source fixtures and add files to dist/studio-cli. Seal both
# archives first, leaving the native payload and provenance for the proof.
pnpm test:cli
if [[ "$browser_editor" == true ]]; then
  PRAXITY_BROWSER_ARTIFACT="$PWD/dist/studio-cli" pnpm --filter @praxity/desktop e2e:browser-editor
fi
