import math

from .geo import Grid

CARS = {"primary": 2, "secondary": 2, "tertiary": 1, "trunk": 3}
WIDTH = {"trunk": (21.0, 10.5), "primary": (14.0, 7.0), "secondary": (14.0, 7.0), "tertiary": (7.0, 4.0),
         "unclassified": (6.0, 3.5), "residential": (6.0, 3.5), "living_street": (6.0, 3.5), "service": (4.5, 3.0)}
HALF = {k: v[0] / 2 for k, v in WIDTH.items()}


def half_width(hw, ow):
    w = WIDTH.get(hw)
    return (w[1] if ow else w[0]) / 2 if w else 0.0
RANK = {"trunk": 4, "primary": 3, "secondary": 2, "tertiary": 1}


def _xy(city, p):
    return city.proj.xy(p[0], p[1])


def _unit(dx, dy):
    d = math.hypot(dx, dy)
    return (dx / d, dy / d) if d > 1e-9 else (0.0, 0.0)


def _bearing(dx, dy):
    return (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0


def _away(city, node, ei, reach=12.0):
    ed = city.edges[ei]
    pts = ed["p"] if ed["u"] == node else ed["p"][::-1]
    x0, y0 = _xy(city, pts[0])
    far = pts[-1]
    acc = 0.0
    px, py = x0, y0
    for p in pts[1:]:
        x, y = _xy(city, p)
        acc += math.hypot(x - px, y - py)
        px, py = x, y
        far = p
        if acc >= reach:
            break
    x1, y1 = _xy(city, far)
    return _unit(x1 - x0, y1 - y0)


class Signals:
    def __init__(self, city):
        self.nodes = set(city.data.get("sig", []))
        self.grid = Grid(60.0)
        for lon, lat in city.data.get("sig_pts", []):
            self.grid.add(*city.proj.xy(lon, lat), 1)
        self.zebra = set(city.data.get("zeb", []))
        self.known = bool(city.data.get("sig_pts"))

    def near(self, x, y, r=35.0):
        return any(True for _ in self.grid.near(x, y, r))


def signals(city):
    sg = getattr(city, "_signals", None)
    if sg is None:
        sg = city._signals = Signals(city)
    return sg


def _name(city, ed):
    names = city.data.get("names") or []
    n = ed.get("n", -1)
    return names[n] if 0 <= n < len(names) else ""


def _turn(delta):
    a = abs(delta)
    if a < 35:
        return None
    side = "right" if delta > 0 else "left"
    if a > 150:
        return "uturn"
    return ("slight_" + side) if a < 60 else side


def _traffic(ow, forward):
    if not ow:
        return 0
    return 1 if (ow == 1) == forward else -1


SIDEWALK = 2.0


def _cw(a, b):
    return (b - a) % 360.0


def _rays(city, v):
    out, seen = [], set()
    for _, ei in city.adj[v]:
        ed = city.edges[ei]
        if ed["hw"] not in WIDTH or ei in seen:
            continue
        seen.add(ei)
        d = _away(city, v, ei, 15.0)
        if d == (0.0, 0.0):
            continue
        out.append({"e": ei, "b": _bearing(*d), "d": d, "half": half_width(ed["hw"], bool(ed.get("ow"))), "hw": ed["hw"], "ow": bool(ed.get("ow"))})
    return out


def _cost(r):
    return 1.0 + r["half"] / 7.0


def sweep(rays, a0, a1):
    span_cw, span_ccw = _cw(a0, a1), _cw(a1, a0)
    cw = sorted((r for r in rays if 0.0 < _cw(a0, r["b"]) < span_cw), key=lambda r: _cw(a0, r["b"]))
    ccw = sorted((r for r in rays if 0.0 < _cw(r["b"], a0) < span_ccw), key=lambda r: _cw(r["b"], a0))
    c1, c2 = sum(_cost(r) for r in cw), sum(_cost(r) for r in ccw)
    return (c1, cw, 1) if c1 <= c2 else (c2, ccw, -1)


def arrive(b, side):
    return (b - side) % 360.0


def leave(b, side):
    return (b + side) % 360.0


def _sector(rays, a):
    left = min(rays, key=lambda r: _cw(r["b"], a))
    right = min(rays, key=lambda r: _cw(a, r["b"]))
    return left, right


def corner(rays, a):
    left, right = _sector(rays, a)
    ol, orr = left["half"] + SIDEWALK, right["half"] + SIDEWALK
    dl, dr = left["d"], right["d"]
    nl = (dl[1], -dl[0])
    nr = (-dr[1], dr[0])
    if left is right:
        return (nl[0] * ol, nl[1] * ol)
    cr = dl[0] * dr[1] - dl[1] * dr[0]
    far = 3.0 * max(ol, orr) + 6.0
    if abs(cr) > 0.2:
        pl = (nl[0] * ol, nl[1] * ol)
        pr = (nr[0] * orr, nr[1] * orr)
        t = ((pr[0] - pl[0]) * dr[1] - (pr[1] - pl[1]) * dr[0]) / cr
        q = (pl[0] + dl[0] * t, pl[1] + dl[1] * t)
        if math.hypot(*q) <= far:
            return q
    bx, by = _unit(nl[0] + nr[0], nl[1] + nr[1])
    if (bx, by) == (0.0, 0.0):
        bx, by = nl
    o = max(ol, orr)
    return (bx * o, by * o)


def junction(rays, a0, a1):
    if not rays:
        return 0.0, [], []
    cost, crossed, way = sweep(rays, a0, a1)
    if not crossed:
        return 0.0, [], []
    pts = [corner(rays, a0)]
    for r in crossed:
        pts.append(corner(rays, (r["b"] + 0.5 * way) % 360.0))
    return cost, crossed, pts


def _allowed(ed, forward):
    if ed["hw"] not in WIDTH:
        return (0,)
    t = _traffic(ed.get("ow", 0), forward)
    if t:
        return (1 if t > 0 else -1,)
    return (1, -1)


def sides(city, nodes, edges):
    n = len(edges)
    if not n:
        return [], []
    fwd = [city.edges[ei]["u"] == nodes[k] for k, ei in enumerate(edges)]
    allow = [_allowed(city.edges[ei], fwd[k]) for k, ei in enumerate(edges)]
    rays = [_rays(city, nodes[k + 1]) for k in range(n - 1)]
    ang_in = [_bearing(*_away(city, nodes[k + 1], edges[k], 15.0)) for k in range(n - 1)]
    ang_out = [_bearing(*_away(city, nodes[k + 1], edges[k + 1], 15.0)) for k in range(n - 1)]
    bias = lambda s: 0.05 if s < 0 else 0.0
    best = [{s: (bias(s), None) for s in allow[0]}]
    for k in range(1, n):
        row = {}
        for s in allow[k]:
            choice = None
            for p, (c, _) in best[k - 1].items():
                jc = junction(rays[k - 1], arrive(ang_in[k - 1], p), leave(ang_out[k - 1], s))[0]
                tot = c + jc + bias(s)
                if choice is None or tot < choice[0] - 1e-9:
                    choice = (tot, p)
            row[s] = choice
        best.append(row)
    s = min(best[-1], key=lambda q: best[-1][q][0])
    out = [s]
    for k in range(n - 1, 0, -1):
        s = best[k][s][1]
        out.append(s)
    out.reverse()
    plans = [junction(rays[k], arrive(ang_in[k], out[k]), leave(ang_out[k], out[k + 1])) for k in range(n - 1)]
    return out, plans


def _to_ll(city, v, q):
    x, y = _xy(city, city.nodes[v])
    pr = city.proj
    return [round((x + q[0]) / pr.kx + pr.lon0, 7), round((y + q[1]) / pr.ky + pr.lat0, 7)]


def drive_segs(city, res):
    segs, dist, cur = [], 0.0, res["nodes"][0]
    for ei in res["edges"]:
        ed = city.edges[ei]
        segs.append([round(dist, 1), ed["hw"], _name(city, ed), 1 if ed.get("ow") else 0])
        dist += ed["len"]
        cur = ed["v"] if ed["u"] == cur else ed["u"]
    return segs


def leg(city, res):
    if res is None or not res.get("edges"):
        return {"segs": [], "cross": [], "turns": [], "via": [], "length": 0}
    sg = signals(city)
    nodes = res["nodes"]
    edges = res["edges"]
    side, plans = sides(city, nodes, edges)
    segs, cross, turns, via = [], [], [], []
    dist = 0.0
    cur = nodes[0]
    for k, ei in enumerate(edges):
        ed = city.edges[ei]
        nxt = ed["v"] if ed["u"] == cur else ed["u"]
        segs.append([round(dist, 1), ed["hw"], _name(city, ed), 1 if ed.get("ow") else 0, side[k]])
        dist += ed["len"]
        if k < len(edges) - 1:
            e2 = edges[k + 1]
            _, crossed, pts = plans[k]
            if crossed:
                via.append({"d": round(dist, 1), "pts": [_to_ll(city, nxt, q) for q in pts]})
                for r, a, b in zip(crossed, pts, pts[1:]):
                    if r["hw"] not in CARS:
                        continue
                    x, y = _xy(city, city.nodes[nxt])
                    mid = ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
                    signal = (nxt in sg.nodes or sg.near(x, y)) if sg.known else r["hw"] in ("trunk", "primary", "secondary")
                    cross.append({"at": _to_ll(city, nxt, mid), "road": round(r["b"], 1), "hw": r["hw"], "lanes": CARS[r["hw"]],
                                  "half": r["half"], "ow": r["ow"], "sig": bool(signal), "zebra": nxt in sg.zebra,
                                  "name": _name(city, city.edges[r["e"]]), "d": round(dist, 1)})
            din = _away(city, nxt, ei, 15.0)
            dout = _away(city, nxt, e2, 15.0)
            hin = _bearing(-din[0], -din[1])
            hout = _bearing(*dout)
            delta = (hout - hin + 540.0) % 360.0 - 180.0
            kind = _turn(delta)
            if kind and city.edges[e2]["len"] >= 8:
                onto = _name(city, city.edges[e2])
                if turns and dist - turns[-1]["d"] < 18:
                    turns[-1] = {"d": round(dist, 1), "turn": kind, "onto": onto, "at": city.nodes[nxt]}
                else:
                    turns.append({"d": round(dist, 1), "turn": kind, "onto": onto, "at": city.nodes[nxt]})
        cur = nxt
    return {"segs": segs, "cross": _merge_divided(cross), "turns": turns, "via": via, "length": round(dist, 1)}


def _merge_divided(cross):
    out = []
    for c in cross:
        c.setdefault("median", 0.0)
        if out:
            p = out[-1]
            gap = c["d"] - p["d"]
            diff = abs((c["road"] - p["road"] + 540.0) % 360.0 - 180.0)
            if gap < 40 and (diff < 25 or diff > 155) and p["median"] == 0.0:
                lanes = max(p["lanes"], c["lanes"])
                one = max(p["half"], c["half"])
                median = max(0.6, gap / 2.0 - one)
                out[-1] = dict(p, d=round((p["d"] + c["d"]) / 2.0, 1), median=round(median, 1), lanes=lanes,
                               half=round(median + 2 * one, 1), sig=p["sig"] or c["sig"],
                               at=[round((p["at"][0] + c["at"][0]) / 2, 6), round((p["at"][1] + c["at"][1]) / 2, 6)],
                               name=p["name"] or c["name"])
                continue
        out.append(c)
    return out


def ride_stops(city, line, src_stop, dst_stop, r=30.0):
    if not line or len(line) < 2:
        return []
    pts = [_xy(city, p) for p in line]
    cum = [0.0]
    for i in range(1, len(pts)):
        cum.append(cum[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    out, seen = [], set()
    for i in range(1, len(pts)):
        (x0, y0), (x1, y1) = pts[i - 1], pts[i]
        L = cum[i] - cum[i - 1]
        if L < 1e-6:
            continue
        for sid in set(j for _, j in city.sgrid.near((x0 + x1) / 2, (y0 + y1) / 2, L / 2 + r)):
            if sid in seen:
                continue
            st = city.stops[sid]
            sx, sy = _xy(city, (st["lon"], st["lat"]))
            t = max(0.0, min(1.0, ((sx - x0) * (x1 - x0) + (sy - y0) * (y1 - y0)) / (L * L)))
            px, py = x0 + t * (x1 - x0), y0 + t * (y1 - y0)
            if math.hypot(sx - px, sy - py) <= r:
                seen.add(sid)
                d = cum[i - 1] + t * L
                if 60 < d < cum[-1] - 60 and st.get("name"):
                    out.append({"d": round(d), "name": st["name"]})
    out.sort(key=lambda s: s["d"])
    merged = []
    for s in out:
        if merged and (s["d"] - merged[-1]["d"] < 120 or s["name"] == merged[-1]["name"]):
            continue
        merged.append(s)
    return merged
