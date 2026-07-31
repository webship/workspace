# Graphs

Knowledge graphs of a project's code, one directory per project:
`graphs/<workspace>/<project>/`.

They live here rather than inside the project on purpose. A graph is tens of megabytes, its
clustering is not bit-stable so every rebuild diffs in full, and half the projects worth mapping
are repositories we ship — none of them should gain a graph directory because somebody mapped it.

A graph answers *what depends on what*, deterministically, from the code. For *where is this
explained or configured*, see `rag/` — the two are complements, not alternatives.
