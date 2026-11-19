import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from boran import graph, night


def main():
    city = graph.City(graph.load())
    data = night.Night(city).export()
    out = os.path.join(os.path.dirname(graph.data_path()), "night.json.gz")
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(out, "wb") as f:
        f.write(blob)
    print(out, len(blob) // 1024, "KB raw", os.path.getsize(out) // 1024, "KB gz")
    for k in ("now", "ai"):
        r = data[k]
        print(k, "injuries", r["base"], "->", r["final"], "km", r["km"], "streets", r["n"])


if __name__ == "__main__":
    main()
