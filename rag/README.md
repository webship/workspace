# RAG

Vector databases and the per-project indexes built against them.

An instance is a DDEV project, so it is built and managed from the dashboard page like any other;
the index manifests sit beside it as files.

What this is for, next to `graphs/`: a graph parses code and answers *what depends on what*. It
reads no Markdown, no Twig and none of the Drupal wiring YAML. A RAG index reads exactly those —
the prose, the templates, the configuration — and answers *where is this explained or configured*.
