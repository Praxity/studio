# Download Page Specification

## URL
`praxity.io/download`

## Behavior

### OS detection
On page load, detect the visitor's OS via `navigator.userAgent` (or
`navigator.userAgentData.platform` where available). Show the detected
platform's installer as the primary download button.

### Layout

```text
┌──────────────────────────────────────────────────┐
│                                                  │
│          Download Praxity Studio                 │
│  Local-first eLearning authoring. Your files,   │
│  your machine, no account required.              │
│                                                  │
│        ┌──────────────────────────────┐          │
│        │  Download for macOS          │  <-- primary CTA, detected OS
│        │  Universal (Intel + Apple    │
│        │  Silicon) · v1.0.0 · 120 MB  │
│        └──────────────────────────────┘          │
│                                                  │
│  Also available for:                             │
│    Windows (.exe)  ·  Linux (.AppImage)         │
│                                                  │
│  ─────────────────────────────────────           │
│                                                  │
│  System requirements                             │
│  • macOS 12 Monterey or later (Intel or         │
│    Apple Silicon)                                │
│  • Windows 10 or later (64-bit)                 │
│  • Linux: glibc 2.31+ (Ubuntu 20.04+,           │
│    Fedora 33+, Debian 11+)                      │
│                                                  │
│  Release notes · Changelog · Source code        │
│                                                  │
└──────────────────────────────────────────────────┘
```

### Download URLs

The download URLs point to the latest GitHub Release assets:

| Platform | Asset pattern | URL |
|---|---|---|
| macOS | `Praxity-Studio-{version}-universal.dmg` | `https://github.com/praxity/desktop/releases/latest/download/Praxity-Studio-{version}-universal.dmg` |
| Windows | `Praxity-Studio-Setup-{version}.exe` | `https://github.com/praxity/desktop/releases/latest/download/Praxity-Studio-Setup-{version}.exe` |
| Linux AppImage | `Praxity-Studio-{version}-x86_64.AppImage` | `https://github.com/praxity/desktop/releases/latest/download/Praxity-Studio-{version}-x86_64.AppImage` |
| Linux .deb | `Praxity-Studio-{version}-amd64.deb` | `https://github.com/praxity/desktop/releases/latest/download/Praxity-Studio-{version}-amd64.deb` |

Use the GitHub Releases `/latest/download/` redirect which always resolves to the most recent non-prerelease version.

### Beta downloads

A separate "Beta" section (or toggle) shows the latest pre-release.
Beta builds are only visible to users who explicitly opt in (e.g.,
a "Try the beta" link that expands to show pre-release downloads).

### Accessibility

- All download buttons are `<a>` elements (not `<button>`) since they navigate to a URL.
- Each link has descriptive text including the platform, version, and file size.
- The page is keyboard-navigable with a logical tab order.
- Color contrast meets WCAG AA (4.5:1 for text, 3:1 for large text).
