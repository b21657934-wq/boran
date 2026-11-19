import json
import math
import os
import random
import threading
import time

from boran import astar, nav

LIK = {"ice": (0.70, 0.08), "packed": (0.25, 0.22), "dry": (0.05, 0.70)}
TAU_H = 3.0
KEEP_H = 12.0
MAX_ITEMS = 4000


def drift(p, prior, dt_h, tau=TAU_H):
    if dt_h <= 0:
        return p
    return p + (prior - p) * (1.0 - math.exp(-dt_h / tau))


def observe(p, kind):
    a, b = LIK[kind]
    s, n = p * a, (1.0 - p) * b
    return s / (s + n) if s + n > 0 else p


def belief(prior, obs, now):
    if not obs:
        return prior
    obs = sorted(obs)
    p, last = prior, obs[0][0]
    for o in obs:
        p = observe(drift(p, prior, (o[0] - last) / 3600.0), o[1])
        last = o[0]
    return min(0.99, max(0.01, drift(p, prior, (now - last) / 3600.0)))


def predicted(risk):
    return "ice" if risk >= 0.5 else "packed" if risk >= 0.25 else "dry"


def foot_traffic(city, points, runs=900, seed=7):
    rnd = random.Random(seed)
    nodes = [city.nearest_node(lon, lat) for lon, lat in points]
    xy = [city.proj.xy(lon, lat) for lon, lat in points]
    used = [0] * len(city.edges)
    zero = [0.0] * len(city.edges)
    done = tries = 0
    while done < runs and tries < runs * 20 and len(nodes) > 1:
        tries += 1
        a, b = rnd.sample(range(len(nodes)), 2)
        d = math.hypot(xy[a][0] - xy[b][0], xy[a][1] - xy[b][1])
        if not 300.0 < d < 2500.0 or nodes[a] == nodes[b]:
            continue
        res = astar.search(city, nodes[a], nodes[b], zero, 0.0, safe=False)
        if res is None:
            continue
        for ei in res["edges"]:
            used[ei] += 1
        done += 1
    return used


class Store:
    def __init__(self, city, points, runs=900, seed=True, now=None, avoid=()):
        self.city = city
        self.lock = threading.Lock()
        self.items = []
        self.ids = set()
        self.version = 0
        self.flow = foot_traffic(city, points, runs)
        ranked = sorted((f for f in self.flow if f > 0), reverse=True)
        self.fmax = ranked[0] if ranked else 1
        self.busy = ranked[len(ranked) // 20] if len(ranked) > 20 else self.fmax
        self.calm = ranked[len(ranked) // 4] if len(ranked) > 4 else 1
        self.published = (None, 0.0)
        self.fleet = None
        self.fresh = []
        self.hall_written = -1
        if seed:
            self.seed(now or time.time(), avoid)

    def add(self, rid, kind, lon, lat, pred=None, risk=None, by_city=False, t=None, edges=None):
        if kind not in LIK or not rid:
            return False
        s, w, n, e = self.city.data["bbox"]
        if not (s <= lat <= n and w <= lon <= e):
            return False
        with self.lock:
            if rid in self.ids:
                return False
            edge, spread = self.snap(lon, lat)
            if edges:
                spread = sorted(set(spread) | {int(e) for e in edges[:60] if 0 <= int(e) < len(self.city.edges)})
            self.items.append({"id": rid, "k": kind, "lon": round(lon, 6), "lat": round(lat, 6), "e": edge, "es": spread,
                               "t": float(t if t is not None else time.time()), "pred": pred, "risk": risk, "city": bool(by_city)})
            self.ids.add(rid)
            if self.fleet is not None and not by_city and not rid.startswith("demo-"):
                self.fresh.append(self.items[-1])
            self._prune(self.items[-1]["t"])
            self.version += 1
        return True

    def snap(self, lon, lat, r=400.0, spread=12.0):
        x, y = self.city.proj.xy(lon, lat)
        best, close = None, []
        for _, e in self.city.egrid.near(x, y, r):
            pts = [self.city.proj.xy(p[0], p[1]) for p in self.city.edges[e]["p"]]
            for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                dx, dy = x2 - x1, y2 - y1
                L2 = dx * dx + dy * dy
                u = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / L2)) if L2 > 0 else 0.0
                d = math.hypot(x - x1 - u * dx, y - y1 - u * dy)
                if best is None or d < best[0]:
                    best = (d, e)
                if d <= spread and (not close or close[-1] != e):
                    close.append(e)
        if not best:
            e = self.city.nearest_edge(lon, lat)
            return e, [e]
        return best[1], sorted(set(close) | {best[1]})

    def label(self, e):
        name = nav._name(self.city, self.city.edges[e])
        if name:
            return name, False
        ed = self.city.edges[e]
        mid = ed["p"][len(ed["p"]) // 2]
        x, y = self.city.proj.xy(*mid)
        best = None
        for d, f in self.city.egrid.near(x, y, 120.0):
            nm = nav._name(self.city, self.city.edges[f])
            if nm and (best is None or d < best[0]):
                best = (d, nm)
        return (best[1], True) if best else ("", False)

    def _prune(self, now):
        cut = now - KEEP_H * 3600.0
        keep = [r for r in self.items if r["t"] >= cut][-MAX_ITEMS:]
        if len(keep) != len(self.items):
            self.ids = {r["id"] for r in keep}
            self.items = keep

    def recent(self, now):
        cut = now - KEEP_H * 3600.0
        with self.lock:
            return [dict(r) for r in self.items if r["t"] >= cut]

    def by_edge(self, now):
        out = {}
        for r in self.recent(now):
            for e in r["es"]:
                out.setdefault(e, []).append((r["t"], r["k"], r["id"]))
        return out

    def overlay(self, risks, now):
        risks = list(risks)
        for e, obs in self.by_edge(now).items():
            risks[e] = belief(risks[e], obs, now)
        return risks

    def level(self, f):
        return "high" if f >= self.busy else "mid" if f >= self.calm else "low"

    def top(self, risks, now, k=10):
        obs = self.by_edge(now)
        cand = set(obs)
        cand.update(sorted(range(len(self.flow)), key=lambda i: -self.flow[i] * min(self.city.edges[i]["len"], 200.0))[:500])
        scored = []
        for e in cand:
            p = belief(risks[e], obs.get(e, []), now)
            if p < 0.35:
                continue
            ln = self.city.edges[e]["len"]
            scored.append((p * (self.flow[e] / self.fmax) * (0.3 + min(ln, 200.0) / 200.0) + (0.25 * p if e in obs else 0.0), e, p))
        scored.sort(reverse=True)
        picked = []
        for score, e, p in scored:
            ed = self.city.edges[e]
            name, near = self.label(e)
            pts = ed["p"]
            mid = pts[len(pts) // 2]
            mx, my = self.city.proj.xy(*mid)
            marks = sorted(obs.get(e, []))
            twin = next((it for it in picked if it["name"] == name and math.hypot(it["_x"] - mx, it["_y"] - my) < 600.0), None)
            if twin:
                twin["_ids"].update(m[2] for m in marks)
                twin["len"] += round(ed["len"])
                twin["p"] = max(twin["p"], round(p, 2))
                if marks and (twin["last"] is None or marks[-1][0] > twin["last"]):
                    twin["last"] = int(marks[-1][0])
                    twin["sanded"] = marks[-1][1] == "dry"
                twin["edges"].append(e)
                continue
            if len(picked) >= k:
                continue
            picked.append({"_ids": {m[2] for m in marks}, "e": e, "edges": [e], "name": name, "near": near, "hw": ed["hw"], "len": round(ed["len"]), "p": round(p, 2),
                           "flow": self.level(self.flow[e]), "n": len(marks), "last": int(marks[-1][0]) if marks else None,
                           "sanded": bool(marks) and marks[-1][1] == "dry", "lon": mid[0], "lat": mid[1], "_x": mx, "_y": my})
        for it in picked:
            it.pop("_x")
            it.pop("_y")
            it["n"] = len(it.pop("_ids"))
        return picked

    def done(self, now, k=5):
        last = {}
        for r in self.recent(now):
            if r["e"] not in last or r["t"] > last[r["e"]]["t"]:
                last[r["e"]] = r
        out = []
        for e, r in sorted(last.items(), key=lambda kv: -kv[1]["t"]):
            if r["k"] != "dry":
                continue
            name, near = self.label(e)
            if any(it["name"] == name for it in out):
                continue
            out.append({"e": e, "name": name, "near": near, "len": round(self.city.edges[e]["len"]), "last": int(r["t"]),
                        "city": r["city"], "lon": r["lon"], "lat": r["lat"]})
            if len(out) >= k:
                break
        return out

    def export(self, risks, now):
        reps = self.recent(now)
        obs = self.by_edge(now)
        segs = []
        for e, o in obs.items():
            last = max(o)[1]
            o = [m[:2] for m in o]
            segs.append({"e": e, "p": round(belief(risks[e], o, now), 2), "k": last, "n": len(o), "line": self.city.edges[e]["p"]})
        return {"v": self.version, "now": int(now),
                "reports": [[r["id"], r["k"], r["lon"], r["lat"], int(r["t"]), 1 if r["city"] else 0, r["pred"] or "", r["e"]] for r in reps],
                "segs": segs, "top": [q for q in self.top(risks, now) if not q["sanded"]], "done": self.done(now)}

    def dispatch(self, risks, now):
        if self.fleet is None:
            return
        with self.lock:
            fresh, self.fresh = self.fresh, []
        if not fresh:
            return
        obs = self.by_edge(now)
        for r in fresh:
            if r["t"] < now - 600.0:
                continue
            seen = obs.get(r["e"], [])
            p = belief(risks[r["e"]], seen, now)
            prior = belief(risks[r["e"]], [o for o in seen if o[2] != r["id"]], now)
            name, near = self.label(r["e"])
            self.fleet.handle(dict(r, name=name, near=near), p, now, prior)

    @staticmethod
    def _write(folder, name, data):
        blob = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        path = os.path.join(folder, name)
        tmp = path + ".%d.tmp" % threading.get_ident()
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(blob)
        os.replace(tmp, path)

    def publish(self, folder, risks, now, every=60.0):
        self.dispatch(risks, now)
        if self.fleet is not None and self.fleet.version != self.hall_written:
            v = self.fleet.version
            self._write(folder, "hall.json", self.fleet.export(now))
            self._write(folder, "feed.json", self.fleet.export_feed(now))
            self.hall_written = v
        v, at = self.published
        if v == self.version and now - at < every:
            return False
        self._write(folder, "reports.json", self.export(risks, now))
        self.published = (self.version, now)
        return True

    def seed(self, now, avoid=(), n=22):
        rnd = random.Random(2026)
        far = []
        for x, y in (self.city.proj.xy(lon, lat) for lon, lat in avoid):
            far.append((x, y))
        busy = sorted(range(len(self.flow)), key=lambda i: -self.flow[i])[:160]
        pool = []
        for e in busy:
            ed = self.city.edges[e]
            mid = ed["p"][len(ed["p"]) // 2]
            mx, my = self.city.proj.xy(*mid)
            if all(math.hypot(mx - x, my - y) > 600.0 for x, y in far):
                pool.append((e, mid))
        rnd.shuffle(pool)
        kinds = ["ice"] * 13 + ["packed"] * 4 + ["dry"] * 5
        for i, (e, mid) in enumerate(pool[:n]):
            kind = kinds[i % len(kinds)]
            age = rnd.uniform(0.15, 7.0) * 3600.0
            for j in range(1 if kind == "dry" else rnd.choice((1, 1, 2, 3))):
                lon = mid[0] + rnd.uniform(-0.00012, 0.00012)
                lat = mid[1] + rnd.uniform(-0.00008, 0.00008)
                self.add("demo-%d-%d" % (i, j), kind, lon, lat, t=now - age + j * rnd.uniform(300, 1500))
        self.version += 1
