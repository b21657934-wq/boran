import gzip
import json
import os
import time

import requests

from . import config
from .geo import Grid, Projector, haversine

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
WALK = "trunk|primary|secondary|tertiary|residential|living_street|pedestrian|footway|path|unclassified|cycleway|steps|service|track"
CLEANED = {"primary", "secondary", "tertiary", "pedestrian"}
BIG = {"primary", "secondary"}
FEATURE_BITS = {"shade": 1, "open": 2, "uncleaned": 4, "stop": 8, "bridge": 16}
CELL = (0.02, 0.03)
HEAT_CELL = (0.003, 0.0045)


def overpass(query, timeout=100):
    last = None
    for attempt in range(2):
        for url in MIRRORS:
            try:
                r = requests.post(url, data={"data": query}, timeout=timeout, headers={"User-Agent": "boran-student-project/0.1"})
                if r.status_code == 200 and r.text.lstrip().startswith("{"):
                    return r.json().get("elements", [])
                last = f"{url}: HTTP {r.status_code}"
            except Exception as e:
                last = f"{url}: {e}"
        time.sleep(3)
    raise RuntimeError(f"Overpass unavailable ({last})")


def fetch_raw(bbox=config.BBOX):
    s, w, n, e = bbox
    bb = f"{s},{w},{n},{e}"
    roads = overpass(f'[out:json][timeout:120];way["highway"~"^({WALK})$"]({bb});out geom;')
    buildings = []
    mid_lat, mid_lon = (s + n) / 2, (w + e) / 2
    for a, b, c, d in [(s, w, mid_lat, mid_lon), (s, mid_lon, mid_lat, e), (mid_lat, w, n, mid_lon), (mid_lat, mid_lon, n, e)]:
        buildings += overpass(f'[out:json][timeout:120];way["building"]({a},{b},{c},{d});out geom;')
    misc = overpass(f'[out:json][timeout:120];(way["waterway"="river"]({bb});way["natural"="water"]({bb}););out geom;')
    misc += overpass(
        f'[out:json][timeout:120];(node["highway"="bus_stop"]({bb});nwr["shop"="mall"]({bb});'
        f'node["amenity"~"^(cafe|fast_food)$"]({bb}););out center;'
    )
    return {"roads": roads, "buildings": buildings, "misc": misc}


def _height(tags, area, seed):
    for key in ("height", "building:height"):
        v = tags.get(key)
        if v:
            try:
                return max(3.0, float(str(v).replace("m", "").replace(",", ".").strip()))
            except ValueError:
                pass
    lv = tags.get("building:levels")
    if lv:
        try:
            return max(3.0, float(str(lv).split(";")[0].replace(",", ".")) * 3.2)
        except ValueError:
            pass
    kind = tags.get("building", "yes")
    j = (seed % 7) / 7.0
    if kind in ("garage", "garages", "shed", "kiosk", "service", "roof", "hut"):
        return 3.0 + j
    if kind in ("house", "detached", "terrace", "semidetached_house"):
        return 6.0 + 2 * j
    if kind in ("apartments", "residential", "dormitory", "hotel"):
        return 22.0 + 20 * j
    if kind in ("retail", "commercial", "office", "university", "school", "hospital", "public"):
        return 14.0 + 10 * j
    return (9.0 + 9 * j) if area > 250 else (5.0 + 3 * j)


def _ring_area(pts):
    a = 0.0
    for i in range(len(pts) - 1):
        a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
    return abs(a) / 2


def build(raw, demo=False):
    s, w, n, e = config.BBOX
    proj = Projector((s + n) / 2, (w + e) / 2)
    q = lambda v: round(v, 5)

    buildings = []
    bgrid = Grid(80.0)
    seen = set()
    for el in raw["buildings"]:
        if el.get("type") != "way" or el.get("id") in seen:
            continue
        seen.add(el.get("id"))
        geom = el.get("geometry") or []
        if len(geom) < 4:
            continue
        ring = [(g["lon"], g["lat"]) for g in geom]
        xy = [proj.xy(*p) for p in ring]
        area = _ring_area(xy)
        if area < 12:
            continue
        hgt = round(_height(el.get("tags", {}), area, el.get("id", 0)), 1)
        cx = sum(p[0] for p in xy) / len(xy)
        cy = sum(p[1] for p in xy) / len(xy)
        bgrid.add(cx, cy, hgt)
        buildings.append({"p": [[q(a), q(b)] for a, b in ring], "h": hgt})

    stops, warm, water_lines, water_polys = [], [], [], []
    sgrid, wgrid = Grid(120.0), Grid(120.0)
    signal_ids, zebra_ids, signal_pts = set(), set(), []
    for el in raw["misc"]:
        tags = el.get("tags", {})
        if el.get("type") == "node" and (tags.get("highway") == "traffic_signals" or tags.get("crossing") == "traffic_signals"):
            signal_ids.add(el.get("id"))
            signal_pts.append((el["lon"], el["lat"]))
            continue
        if el.get("type") == "node" and tags.get("highway") == "crossing":
            zebra_ids.add(el.get("id"))
            continue
        if el.get("type") == "node":
            lon, lat = el["lon"], el["lat"]
        elif "center" in el:
            lon, lat = el["center"]["lon"], el["center"]["lat"]
        else:
            lon = lat = None
        if tags.get("highway") == "bus_stop" and lon is not None:
            stops.append({"lon": q(lon), "lat": q(lat), "name": tags.get("name:ru") or tags.get("name") or ""})
            sgrid.add(*proj.xy(lon, lat), len(stops) - 1)
        elif (tags.get("shop") == "mall" or tags.get("amenity") in ("cafe", "fast_food")) and lon is not None:
            kind = "mall" if tags.get("shop") == "mall" else "cafe"
            warm.append({"lon": q(lon), "lat": q(lat), "name": tags.get("name:ru") or tags.get("name") or "", "kind": kind})
            wgrid.add(*proj.xy(lon, lat), len(warm) - 1)
        elif el.get("type") == "way" and el.get("geometry"):
            pts = [[q(g["lon"]), q(g["lat"])] for g in el["geometry"]]
            if tags.get("waterway") == "river":
                water_lines.append(pts)
            elif tags.get("natural") == "water" and len(pts) >= 4 and pts[0] == pts[-1]:
                water_polys.append(pts)
    for i, st in enumerate(stops):
        x, y = proj.xy(st["lon"], st["lat"])
        st["warm"] = any(True for _ in wgrid.near(x, y, 120.0))

    use = {}
    ways, areas = [], []
    for el in raw["roads"]:
        if el.get("type") != "way" or not el.get("geometry") or not el.get("nodes"):
            continue
        tags = el.get("tags", {})
        if tags.get("access") in ("private", "no") or tags.get("foot") == "no" or tags.get("service") == "drive-through":
            continue
        ids = el["nodes"]
        geom = el["geometry"]
        if len(ids) != len(geom) or len(ids) < 2:
            continue
        if tags.get("area") == "yes":
            if len(ids) >= 4 and ids[0] == ids[-1] and tags.get("highway") in ("pedestrian", "footway", "path", "service"):
                areas.append((ids, geom, tags))
            else:
                continue
        ways.append((ids, geom, tags))
        for k, nid in enumerate(ids):
            use[nid] = use.get(nid, 0) + (2 if k in (0, len(ids) - 1) else 1)

    node_index, nodes, edges = {}, [], []
    names, name_index = [], {}

    def name_id(tags):
        nm = tags.get("name:ru") or tags.get("name") or ""
        if not nm:
            return -1
        if nm not in name_index:
            name_index[nm] = len(names)
            names.append(nm)
        return name_index[nm]

    def node(nid, g):
        if nid not in node_index:
            node_index[nid] = len(nodes)
            nodes.append((g["lon"], g["lat"]))
        return node_index[nid]

    for ids, geom, tags in ways:
        hw = tags.get("highway")
        nid_name = name_id(tags)
        sidewalk = tags.get("footway") == "sidewalk"
        bridge = tags.get("bridge") not in (None, "no")
        start = 0
        for k in range(1, len(ids)):
            if use.get(ids[k], 0) > 1 or k == len(ids) - 1:
                seg = geom[start:k + 1]
                u, v = node(ids[start], geom[start]), node(ids[k], geom[k])
                start = k
                if u == v:
                    continue
                length = sum(haversine(seg[i]["lon"], seg[i]["lat"], seg[i + 1]["lon"], seg[i + 1]["lat"]) for i in range(len(seg) - 1))
                if length < 0.5:
                    continue
                mid = seg[len(seg) // 2]
                mx, my = proj.xy(mid["lon"], mid["lat"])
                near_b = list(bgrid.near(mx, my, 120.0))
                mask = 0
                if any(h >= 20 for d, h in near_b if d <= 60 * 60):
                    mask |= FEATURE_BITS["shade"]
                if hw in BIG or bridge or not near_b:
                    mask |= FEATURE_BITS["open"]
                if hw not in CLEANED and not sidewalk:
                    mask |= FEATURE_BITS["uncleaned"]
                if any(True for _ in sgrid.near(mx, my, 60.0)):
                    mask |= FEATURE_BITS["stop"]
                if bridge:
                    mask |= FEATURE_BITS["bridge"]
                is_warm = any(True for _ in wgrid.near(mx, my, 90.0))
                edge = {"u": u, "v": v, "len": length, "mask": mask, "warm": is_warm, "hw": hw,
                        "p": [[q(g["lon"]), q(g["lat"])] for g in seg]}
                if nid_name >= 0:
                    edge["n"] = nid_name
                edges.append(edge)

    refs = {}
    for wi, (ids, _, _) in enumerate(ways):
        for nid in set(ids):
            refs[nid] = refs.get(nid, 0) + 1
    for ids, geom, tags in areas:
        ring = [proj.xy(g["lon"], g["lat"]) for g in geom]
        entries = []
        for nid, g in zip(ids[:-1], geom[:-1]):
            if refs.get(nid, 0) >= 2 and nid in node_index and nid not in [e[0] for e in entries]:
                entries.append((nid, g))
        entries = entries[:40]
        nm = name_id(tags)
        for i in range(len(entries)):
            for j in range(i + 1, len(entries)):
                (na, ga), (nb, gb) = entries[i], entries[j]
                length = haversine(ga["lon"], ga["lat"], gb["lon"], gb["lat"])
                if length < 3 or length > 450:
                    continue
                ax, ay = proj.xy(ga["lon"], ga["lat"])
                bx, by = proj.xy(gb["lon"], gb["lat"])
                if not all(_inside(ring, ax + (bx - ax) * f, ay + (by - ay) * f) for f in (0.1, 0.3, 0.5, 0.7, 0.9)):
                    continue
                mx, my = (ax + bx) / 2, (ay + by) / 2
                near_b = list(bgrid.near(mx, my, 120.0))
                mask = FEATURE_BITS["uncleaned"] if tags.get("highway") != "pedestrian" else 0
                if not near_b:
                    mask |= FEATURE_BITS["open"]
                if any(h >= 20 for d, h in near_b if d <= 60 * 60):
                    mask |= FEATURE_BITS["shade"]
                edge = {"u": node_index[na], "v": node_index[nb], "len": length, "mask": mask, "warm": any(True for _ in wgrid.near(mx, my, 90.0)),
                        "hw": "pedestrian", "p": [[q(ga["lon"]), q(ga["lat"])], [q(gb["lon"]), q(gb["lat"])]]}
                if nm >= 0:
                    edge["n"] = nm
                edges.append(edge)

    comp = _largest_component(len(nodes), edges)
    remap, new_nodes = {}, []
    for i, c in enumerate(comp):
        if c:
            remap[i] = len(new_nodes)
            new_nodes.append(nodes[i])
    edges = [dict(ed, u=remap[ed["u"]], v=remap[ed["v"]]) for ed in edges if ed["u"] in remap and ed["v"] in remap]
    sig = sorted(remap[node_index[i]] for i in signal_ids if i in node_index and node_index[i] in remap)
    zeb = sorted(remap[node_index[i]] for i in zebra_ids if i in node_index and node_index[i] in remap)
    return {
        "names": names,
        "sig": sig,
        "zeb": zeb,
        "sig_pts": [[q(a), q(b)] for a, b in signal_pts],
        "demo": demo,
        "bbox": list(config.BBOX),
        "nodes": [[q(a), q(b)] for a, b in new_nodes],
        "edges": edges,
        "buildings": buildings,
        "water": {"lines": water_lines, "polys": water_polys},
        "stops": stops,
        "warm": warm,
    }


def _inside(ring, x, y):
    c = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1:
            c = not c
    return c


def _largest_component(n, edges):
    adj = [[] for _ in range(n)]
    for ed in edges:
        adj[ed["u"]].append(ed["v"])
        adj[ed["v"]].append(ed["u"])
    label = [-1] * n
    sizes = []
    for i in range(n):
        if label[i] >= 0 or not adj[i]:
            continue
        stack = [i]
        label[i] = len(sizes)
        cnt = 0
        while stack:
            a = stack.pop()
            cnt += 1
            for b in adj[a]:
                if label[b] < 0:
                    label[b] = len(sizes)
                    stack.append(b)
        sizes.append(cnt)
    if not sizes:
        return [False] * n
    best = max(range(len(sizes)), key=lambda i: sizes[i])
    return [lb == best for lb in label]


class City:
    def __init__(self, data):
        self.data = data
        self.nodes = data["nodes"]
        self.edges = data["edges"]
        self.stops = data["stops"]
        self.demo = data.get("demo", False)
        s, w, n, e = data["bbox"]
        self.proj = Projector((s + n) / 2, (w + e) / 2)
        self.adj = [[] for _ in self.nodes]
        for i, ed in enumerate(self.edges):
            self.adj[ed["u"]].append((ed["v"], i))
            self.adj[ed["v"]].append((ed["u"], i))
        self.ngrid = Grid(150.0)
        for i, (lon, lat) in enumerate(self.nodes):
            self.ngrid.add(*self.proj.xy(lon, lat), i)
        self.egrid = Grid(150.0)
        for i, ed in enumerate(self.edges):
            mid = ed["p"][len(ed["p"]) // 2]
            self.egrid.add(*self.proj.xy(mid[0], mid[1]), i)
        self.sgrid = Grid(300.0)
        for i, st in enumerate(self.stops):
            self.sgrid.add(*self.proj.xy(st["lon"], st["lat"]), i)

    def nearest_node(self, lon, lat):
        return self.ngrid.nearest(*self.proj.xy(lon, lat), rmax=5000.0)[0]

    def nearest_edge(self, lon, lat):
        return self.egrid.nearest(*self.proj.xy(lon, lat), rmax=5000.0)[0]

    def stops_near(self, lon, lat, k=5, r=1200.0):
        x, y = self.proj.xy(lon, lat)
        for radius in (r, r * 2, r * 4):
            found = sorted(self.sgrid.near(x, y, radius), key=lambda t: t[0])
            if found:
                return [i for _, i in found[:k]]
        return []

    def frontend(self, cell=CELL):
        d = self.data
        s, w, n, e = d["bbox"]
        tiles = {}
        for ed in d["edges"]:
            mid = ed["p"][len(ed["p"]) // 2]
            key = f"{int((mid[1] - s) // cell[0])}_{int((mid[0] - w) // cell[1])}"
            tiles.setdefault(key, []).append([ed["p"], ed["mask"] & 31, 1 if ed["hw"] in BIG else 0])
        heat = {}
        for ed in d["edges"]:
            mid = ed["p"][len(ed["p"]) // 2]
            k = (int((mid[1] - s) // HEAT_CELL[0]), int((mid[0] - w) // HEAT_CELL[1]), ed["mask"] & 31)
            h = heat.setdefault(k, [0.0, 0.0, 0.0])
            h[0] += mid[0] * ed["len"]
            h[1] += mid[1] * ed["len"]
            h[2] += ed["len"]
        tiles["heat"] = [[round(h[0] / h[2], 4), round(h[1] / h[2], 4), k[2], round(h[2] / 100, 1)] for k, h in heat.items() if h[2] > 0]
        meta = {
            "demo": d.get("demo", False),
            "bbox": d["bbox"],
            "cell": list(cell),
            "tiles": sorted(k for k in tiles if k != "heat"),
            "stats": {"nodes": len(self.nodes), "edges": len(self.edges)},
            "water": d["water"],
            "stops": d["stops"],
            "warm": d["warm"],
        }
        return meta, tiles


def data_path():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "city.json.gz")


def save(data, path=None):
    path = path or data_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    slim = {k: v for k, v in data.items() if k != "buildings"}
    slim["n_buildings"] = len(data.get("buildings", []))
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(slim, f, ensure_ascii=False, separators=(",", ":"))


def load(path=None):
    path = path or data_path()
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def get_city():
    path = data_path()
    if os.path.exists(path):
        try:
            data = load(path)
            if len(data.get("edges", [])) >= 200:
                return City(data)
        except Exception:
            pass
    from . import demo
    return City(build(demo.raw(), demo=True))
