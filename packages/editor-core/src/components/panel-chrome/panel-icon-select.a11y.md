# Select descriptions

Settled 2026-10-12.

- Shipped: Mantine's `description` slot owns the input's description association. Content inside it stays inline, because the slot renders a paragraph.
- Rejected: passing `aria-describedby` directly. Mantine's Input replaces it with the wrapper's description ID.
- Rejected: a paragraph inside the description slot. React reports invalid nested paragraphs.

Verified through the Design panel's input and diagnostic, including English and French recovery states. Native captures use Electron Chromium. Screen-reader speech remains untested.
