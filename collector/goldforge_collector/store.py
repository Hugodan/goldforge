"""JSON / gzipped-JSON helpers for the collector's state and output files."""

import gzip
import json
import os


def load(path, default=None):
    if not os.path.exists(path):
        return default
    try:
        if path.endswith(".gz"):
            with gzip.open(path, "rt", encoding="utf-8") as fh:
                return json.load(fh)
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def save(path, obj, pretty=False):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    kw = {"indent": 1} if pretty else {"separators": (",", ":")}
    if path.endswith(".gz"):
        with gzip.open(tmp, "wt", encoding="utf-8") as fh:
            json.dump(obj, fh, **kw)
    else:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, **kw)
    os.replace(tmp, path)
