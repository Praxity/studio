# Data fetching in editor-core

The standalone CLI uses local service owners; the thin canvas uses the authenticated, rooted Studio HTTP API. The Electron bridge and renderer shell are retired. Retained editor-core components and hooks own their loading, error, and mutation state. `PraxityEditor` has no query provider.

Document text, selection, and undo belong to editor state. Use the grammar document store for source text and parsed blocks, Zustand for shared panel state, and React state for state local to one component.

Reconsider TanStack Query when a concrete file or media workflow needs shared cached reads, deduplication, and invalidation after writes or external file changes. An asynchronous operation alone does not require a query cache.

Do not introduce server-component, hydration, database, or Next.js patterns. They belonged to the deleted web app.
