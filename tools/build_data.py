import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from boran import config, graph

PBF_URL = "https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf"
WALK = set(graph.WALK.split("|"))


def from_pbf(path):
    import osmium

    s, w, n, e = config.BBOX
    inside = lambda lon, lat: w <= lon <= e and s <= lat <= n

    class Handler(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.roads, self.buildings, self.misc = [], [], []

        def node(self, o):
            t = o.tags
            if not o.location.valid() or not inside(o.location.lon, o.location.lat):
                return
            if t.get("highway") == "bus_stop" or t.get("shop") == "mall" or t.get("amenity") in ("cafe", "fast_food"):
                self.misc.append({"type": "node", "id": o.id, "lon": o.location.lon, "lat": o.location.lat, "tags": dict(t)})
            elif t.get("highway") in ("traffic_signals", "crossing") or t.get("crossing") == "traffic_signals":
                self.misc.append({"type": "node", "id": o.id, "lon": o.location.lon, "lat": o.location.lat,
                                  "tags": {k: t.get(k) for k in ("highway", "crossing") if t.get(k)}})

        def way(self, o):
            t = o.tags
            hw, river = t.get("highway"), t.get("waterway") == "river"
            water, mall, bld = t.get("natural") == "water", t.get("shop") == "mall", "building" in t
            if not (hw in WALK or river or water or mall or bld):
                return
            pts = [(nd.ref, nd.location.lon, nd.location.lat) for nd in o.nodes if nd.location.valid()]
            if len(pts) < 2 or len(pts) != len(o.nodes) or not any(inside(x, y) for _, x, y in pts):
                return
            geom = [{"lon": x, "lat": y} for _, x, y in pts]
            tags = dict(t)
            if hw in WALK:
                self.roads.append({"type": "way", "id": o.id, "nodes": [r for r, _, _ in pts], "geometry": geom, "tags": tags})
            if bld:
                self.buildings.append({"type": "way", "id": o.id, "geometry": geom, "tags": tags})
            if mall:
                cx = sum(x for _, x, _ in pts) / len(pts)
                cy = sum(y for _, _, y in pts) / len(pts)
                self.misc.append({"type": "way", "id": o.id, "center": {"lon": cx, "lat": cy}, "tags": {"shop": "mall", "name": tags.get("name", ""), "name:ru": tags.get("name:ru", "")}})
            if river or water:
                self.misc.append({"type": "way", "id": o.id, "geometry": geom, "tags": {k: tags[k] for k in ("waterway", "natural") if k in tags}})

    h = Handler()
    h.apply_file(path, locations=True)
    return {"roads": h.roads, "buildings": h.buildings, "misc": h.misc}


def main():
    source = "overpass"
    try:
        if len(sys.argv) > 1:
            raise RuntimeError("pbf given")
        raw = graph.fetch_raw()
        if len(raw["roads"]) < 500:
            raise RuntimeError("too few roads from Overpass")
    except Exception as exc:
        print("Overpass route skipped:", exc)
        path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/kazakhstan.osm.pbf"
        if not os.path.exists(path):
            print("downloading", PBF_URL)
            urllib.request.urlretrieve(PBF_URL, path)
        raw = from_pbf(path)
        source = "geofabrik"
    data = graph.build(raw)
    data["source"] = source
    if len(data["edges"]) < 500:
        raise SystemExit(f"only {len(data['edges'])} street segments, refusing to save")
    graph.save(data)
    print(f"source {source}: nodes {len(data['nodes'])}, edges {len(data['edges'])}, buildings {len(data['buildings'])}, stops {len(data['stops'])}, warm {len(data['warm'])}")
    print("saved", graph.data_path(), os.path.getsize(graph.data_path()), "bytes")


main()
