#!/usr/bin/env python3
"""Index a project into Milvus, and read the result back.

The worker behind cmd-tools-ragify.sh and cmd-tools-rag.sh. It is run through
`uv run --with pymilvus ...` so there is nothing to install and nothing to keep
in sync — see rag_python() in core/scripts/functions/fun-rag.sh.

Retrieval is Milvus's built-in BM25 function by default: the database itself
tokenises the text and builds the sparse vectors, so no embedding model runs
here and nothing leaves the machine. `--embedding openai` adds a dense vector
per chunk from the OpenAI API and searches both fields together, which is
better on paraphrase and is the only mode that sends content anywhere.

What gets indexed is deliberately the opposite of what graphify covers: prose,
templates and configuration — .md, .twig, *.yml, *.module hooks — the files a
code graph classifies as documents and then never reads.
"""

import argparse
import json
import os
import sys
from typing import Iterable, Iterator, List, Optional

# Milvus VARCHAR tops out at 65535 bytes, and a chunk that long is not a useful
# retrieval unit anyway. Chunks are truncated to this many characters, counted
# in bytes after encoding because the limit is a byte limit and Arabic or emoji
# in a comment would otherwise overflow a chunk that looks short.
MAX_CHUNK_BYTES = 16000

# Only these are read. A whitelist rather than a "skip binaries" heuristic: the
# point is to index what a person would read, and a .png or a .lock is not that.
TEXT_SUFFIXES = {
    # Drupal/PHP, including the extensions that hold hooks — the files graphify
    # does not classify at all.
    ".php", ".module", ".install", ".theme", ".profile", ".engine", ".inc",
    # The wiring and config a Drupal site actually behaves like.
    ".yml", ".yaml", ".toml", ".ini", ".xml", ".json",
    # Templates and front end.
    ".twig", ".html", ".css", ".scss", ".less", ".js", ".jsx", ".ts", ".tsx", ".vue",
    # Prose and scripts.
    ".md", ".markdown", ".txt", ".rst", ".sh", ".bash", ".py", ".rb", ".go", ".sql",
    ".feature", ".gitlab-ci.yml", ".dist",
}

# Files whose name alone says "read me" even without a suffix.
TEXT_NAMES = {
    "README", "CHANGELOG", "LICENSE", "AGENTS.md", "CLAUDE.md", "Dockerfile", "Makefile",
    ".gitlab-ci.yml", "composer.json", "package.json",
}

# Never worth indexing even when the suffix passes: generated, minified or lock data.
SKIP_NAME_PARTS = (".min.js", ".min.css", "-min.js", ".map", "composer.lock", "package-lock.json",
                   "yarn.lock", "patches.lock.json")


def eprint(*args):
    print(*args, file=sys.stderr)


def collection_ok(name: str) -> str:
    """Milvus allows letters, digits and underscore, and no leading digit."""
    safe = "".join(c if (c.isalnum() or c == "_") else "_" for c in name)
    if safe and safe[0].isdigit():
        safe = "c_" + safe
    return safe


def is_text_file(path: str) -> bool:
    base = os.path.basename(path)
    if any(part in base for part in SKIP_NAME_PARTS):
        return False
    if base in TEXT_NAMES:
        return True
    _, ext = os.path.splitext(base)
    return ext.lower() in TEXT_SUFFIXES


def walk_files(root: str, excludes: Iterable[str], max_file_kb: int) -> Iterator[str]:
    """Every indexable file under root, minus the excluded paths.

    Excludes are matched as path prefixes relative to the root ("web/core") and
    as bare directory names ("node_modules"), which is how the workspace already
    expresses them for graphify.
    """
    prefixes = {e.strip("/") for e in excludes if e and "/" in e}
    names = {e.strip("/") for e in excludes if e and "/" not in e}
    names |= {".git", ".ddev", ".idea", "graphify-out", "graphify-yaml"}
    limit = max_file_kb * 1024

    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        rel_dir = "" if rel_dir == "." else rel_dir
        # Prune in place so os.walk does not descend into what we are skipping.
        dirnames[:] = [
            d for d in dirnames
            if d not in names
            and os.path.join(rel_dir, d).lstrip("/") not in prefixes
            and not any(os.path.join(rel_dir, d).lstrip("/").startswith(p + "/") for p in prefixes)
        ]
        for name in filenames:
            full = os.path.join(dirpath, name)
            if not is_text_file(full):
                continue
            try:
                if os.path.getsize(full) > limit or os.path.islink(full):
                    continue
            except OSError:
                continue
            yield full


def chunk_file(path: str, root: str, chunk_lines: int, overlap: int) -> List[dict]:
    """Split one file into overlapping line windows.

    Lines, not tokens: a chunk that keeps whole lines is one you can open at the
    line number it reports, and the overlap keeps a function that straddles a
    boundary findable from either side.
    """
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            lines = handle.read().splitlines()
    except OSError:
        return []

    if not any(line.strip() for line in lines):
        return []

    rel = os.path.relpath(path, root)
    ext = os.path.splitext(path)[1].lower().lstrip(".") or os.path.basename(path)
    step = max(1, chunk_lines - overlap)
    out = []

    for start in range(0, max(1, len(lines)), step):
        window = lines[start:start + chunk_lines]
        text = "\n".join(window).strip()
        if not text:
            continue
        encoded = text.encode("utf-8")
        if len(encoded) > MAX_CHUNK_BYTES:
            text = encoded[:MAX_CHUNK_BYTES].decode("utf-8", errors="ignore")
        out.append({
            "path": rel[:1020],
            "ext": ext[:28],
            "start_line": start + 1,
            "end_line": min(start + chunk_lines, len(lines)),
            # The path is part of the indexed text on purpose: "where is the
            # Educare hero styled" should match a file called hero.twig even when
            # the word never appears inside it.
            "text": rel + "\n" + text,
        })
        if start + chunk_lines >= len(lines):
            break
    return out


def connect(uri: str, token: str):
    from pymilvus import MilvusClient
    return MilvusClient(uri=uri, token=token or "")


def openai_embed(texts: List[str], model: str, key: str) -> List[List[float]]:
    from openai import OpenAI
    client = OpenAI(api_key=key)
    result = client.embeddings.create(model=model, input=texts)
    return [item.embedding for item in result.data]


def build_schema(client, embedding: str, dim: int):
    from pymilvus import DataType, Function, FunctionType

    schema = client.create_schema(auto_id=True, enable_dynamic_field=False)
    schema.add_field("id", DataType.INT64, is_primary=True)
    schema.add_field("path", DataType.VARCHAR, max_length=1024)
    schema.add_field("ext", DataType.VARCHAR, max_length=32)
    schema.add_field("start_line", DataType.INT64)
    schema.add_field("end_line", DataType.INT64)
    # enable_analyzer is what makes the BM25 function legal on this field: it is
    # the tokeniser the sparse vectors are built from.
    schema.add_field("text", DataType.VARCHAR, max_length=65535, enable_analyzer=True)
    schema.add_field("sparse", DataType.SPARSE_FLOAT_VECTOR)
    schema.add_function(Function(
        name="text_bm25",
        function_type=FunctionType.BM25,
        input_field_names=["text"],
        output_field_names=["sparse"],
    ))

    index_params = client.prepare_index_params()
    index_params.add_index(
        field_name="sparse",
        index_type="SPARSE_INVERTED_INDEX",
        metric_type="BM25",
        params={"inverted_index_algo": "DAAT_MAXSCORE"},
    )

    if embedding == "openai":
        schema.add_field("dense", DataType.FLOAT_VECTOR, dim=dim)
        index_params.add_index(field_name="dense", index_type="AUTOINDEX", metric_type="COSINE")

    return schema, index_params


def cmd_index(args) -> int:
    root = os.path.abspath(args.path)
    if not os.path.isdir(root):
        eprint(f"No such project directory: {root}")
        return 1

    name = collection_ok(args.collection)
    embedding = args.embedding
    key = args.openai_key or os.environ.get("OPENAI_API_KEY", "")
    if embedding == "openai" and not key:
        eprint("--embedding openai needs an OpenAI key (settings.yml ai_providers.openai.api_key "
               "or OPENAI_API_KEY).")
        return 1

    client = connect(args.uri, args.token)

    # A dimension is only known once a model has answered, so it is probed with one
    # cheap call rather than hardcoded per model name.
    dim = 0
    if embedding == "openai":
        dim = len(openai_embed(["dimension probe"], args.openai_model, key)[0])

    existing = name in client.list_collections()
    if existing and not args.append:
        client.drop_collection(name)
        existing = False
    if not existing:
        schema, index_params = build_schema(client, embedding, dim)
        client.create_collection(collection_name=name, schema=schema, index_params=index_params)

    files = list(walk_files(root, args.exclude or [], args.max_file_kb))
    total_chunks = 0
    batch: List[dict] = []
    batch_size = 128 if embedding == "openai" else 512

    def flush() -> int:
        nonlocal batch
        if not batch:
            return 0
        if embedding == "openai":
            vectors = openai_embed([row["text"] for row in batch], args.openai_model, key)
            for row, vector in zip(batch, vectors):
                row["dense"] = vector
        client.insert(collection_name=name, data=batch)
        count = len(batch)
        batch = []
        return count

    for index, path in enumerate(files, start=1):
        for chunk in chunk_file(path, root, args.chunk_lines, args.chunk_overlap):
            batch.append(chunk)
            if len(batch) >= batch_size:
                total_chunks += flush()
        if args.progress and index % 200 == 0:
            eprint(f"  {index}/{len(files)} files, {total_chunks + len(batch)} chunks")

    total_chunks += flush()
    client.flush(name)
    client.load_collection(name)

    result = {
        "collection": name,
        "files": len(files),
        "chunks": total_chunks,
        "embedding": embedding,
        "uri": args.uri,
    }
    print(json.dumps(result) if args.json else
          f"Indexed {result['files']} files as {result['chunks']} chunks "
          f"into {name} ({embedding}).")
    return 0


def cmd_search(args) -> int:
    client = connect(args.uri, args.token)
    name = collection_ok(args.collection)
    if name not in client.list_collections():
        eprint(f"No collection {name}. Index it first with cmd-tools-ragify.sh.")
        return 1
    client.load_collection(name)

    fields = ["path", "start_line", "end_line", "text"]
    has_dense = any(f["name"] == "dense" for f in client.describe_collection(name)["fields"])

    if has_dense and args.openai_key:
        # Dense and sparse are asked separately and merged by reciprocal rank
        # fusion: BM25 finds the exact identifier, the embedding finds the
        # paraphrase, and RRF needs no score calibration between the two.
        from pymilvus import AnnSearchRequest, RRFRanker
        vector = openai_embed([args.query], args.openai_model, args.openai_key)[0]
        hits = client.hybrid_search(
            collection_name=name,
            reqs=[
                AnnSearchRequest(data=[args.query], anns_field="sparse", param={}, limit=args.limit),
                AnnSearchRequest(data=[vector], anns_field="dense", param={}, limit=args.limit),
            ],
            ranker=RRFRanker(),
            limit=args.limit,
            output_fields=fields,
        )
    else:
        hits = client.search(
            collection_name=name,
            data=[args.query],
            anns_field="sparse",
            limit=args.limit,
            output_fields=fields,
        )

    rows = [
        {
            "score": round(float(hit["distance"]), 4),
            "path": hit["entity"]["path"],
            "lines": f"{hit['entity']['start_line']}-{hit['entity']['end_line']}",
            "text": hit["entity"]["text"],
        }
        for hit in (hits[0] if hits else [])
    ]

    if args.json:
        print(json.dumps(rows, indent=2))
        return 0

    if not rows:
        print(f"No match for {args.query!r} in {name}.")
        return 0

    for row in rows:
        print(f"\n\033[1m{row['path']}:{row['lines']}\033[0m  (score {row['score']})")
        body = row["text"].split("\n", 1)[1] if "\n" in row["text"] else row["text"]
        for line in body.splitlines()[: args.context]:
            print(f"  {line}")
    print()
    return 0


def cmd_collections(args) -> int:
    client = connect(args.uri, args.token)
    names = sorted(client.list_collections())
    rows = []
    for name in names:
        try:
            stats = client.get_collection_stats(name)
            count = int(stats.get("row_count", 0))
        except Exception:
            count = -1
        rows.append({"collection": name, "chunks": count})

    if args.json:
        print(json.dumps(rows, indent=2))
        return 0
    if not rows:
        print("No collections yet. Index one with: cmd-tools-ragify.sh <project>")
        return 0
    print(f"{'COLLECTION':<52} {'CHUNKS':>10}")
    for row in rows:
        print(f"{row['collection']:<52} {row['chunks']:>10}")
    return 0


def cmd_info(args) -> int:
    client = connect(args.uri, args.token)
    name = collection_ok(args.collection)
    if name not in client.list_collections():
        eprint(f"No collection {name}.")
        return 1
    described = client.describe_collection(name)
    stats = client.get_collection_stats(name)
    info = {
        "collection": name,
        "chunks": int(stats.get("row_count", 0)),
        "fields": [f["name"] for f in described["fields"]],
        "functions": [f.get("name") for f in described.get("functions", [])],
    }
    if args.json:
        print(json.dumps(info, indent=2))
        return 0
    print(f"Collection : {info['collection']}")
    print(f"Chunks     : {info['chunks']}")
    print(f"Fields     : {', '.join(info['fields'])}")
    print(f"Functions  : {', '.join(x for x in info['functions'] if x) or '—'}")
    return 0


def cmd_drop(args) -> int:
    client = connect(args.uri, args.token)
    name = collection_ok(args.collection)
    if name not in client.list_collections():
        eprint(f"No collection {name}.")
        return 1
    client.drop_collection(name)
    print(f"Dropped {name}. Rebuild it with cmd-tools-ragify.sh in its workspace folder.")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Index a project into Milvus and query it.")
    parser.add_argument("--uri", default="http://127.0.0.1:19530")
    parser.add_argument("--token", default="")
    parser.add_argument("--json", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("index")
    p.add_argument("--collection", required=True)
    p.add_argument("--path", required=True)
    p.add_argument("--exclude", nargs="*", default=[])
    p.add_argument("--chunk-lines", type=int, default=60)
    p.add_argument("--chunk-overlap", type=int, default=10)
    p.add_argument("--max-file-kb", type=int, default=512)
    p.add_argument("--embedding", choices=["bm25", "openai"], default="bm25")
    p.add_argument("--openai-model", default="text-embedding-3-small")
    p.add_argument("--openai-key", default="")
    p.add_argument("--append", action="store_true",
                   help="Add to the collection instead of rebuilding it.")
    p.add_argument("--progress", action="store_true")
    p.set_defaults(func=cmd_index)

    p = sub.add_parser("search")
    p.add_argument("--collection", required=True)
    p.add_argument("--query", required=True)
    p.add_argument("--limit", type=int, default=5)
    p.add_argument("--context", type=int, default=12)
    p.add_argument("--openai-model", default="text-embedding-3-small")
    p.add_argument("--openai-key", default="")
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("collections")
    p.set_defaults(func=cmd_collections)

    p = sub.add_parser("info")
    p.add_argument("--collection", required=True)
    p.set_defaults(func=cmd_info)

    p = sub.add_parser("drop")
    p.add_argument("--collection", required=True)
    p.set_defaults(func=cmd_drop)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
