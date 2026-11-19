import heapq
import math
import threading

from . import night, reports

SEC_PER_MIN = 1.0
THINK = 2.5
GO_P = 0.4
MERGE_M = 150.0
CONFIRM_S = 1800.0
SAND_R = 35.0
MIN_SAND_S = 3.0
KEEP_JOBS_S = 900.0
KEEP_FEED = 60
KEEP_STATUS = 600
IDLE_HOME_S = 1800.0
PER_DEPOT = 2


class Fleet:
    def __init__(self, city, per_depot=PER_DEPOT):
        self.city = city
        self.lock = threading.Lock()
        d = night.Drive(city)
        main = d.core()
        d.adj = {u: [(v, e) for v, e in lst if v in main] for u, lst in d.adj.items() if u in main}
        self.drive = d
        self.radj = {}
        for u, lst in d.adj.items():
            for v, e in lst:
                self.radj.setdefault(v, []).append((u, e))
        self.trucks = []
        for lon, lat in night.DEPOTS:
            n = d.nearest(lon, lat)
            for _ in range(per_depot):
                self.trucks.append({"id": len(self.trucks) + 1, "home": n, "node": n, "free": -1e18})
        self.jobs = []
        self.feed = []
        self.waiting = []
        self.status = {}
        self.next_job = 1
        self.version = 0

    def _search(self, target, go):
        at = {}
        for tr in self.trucks:
            at.setdefault(tr["node"], []).append(tr)
        dist = {target: 0.0}
        came = {}
        heap = [(0.0, target)]
        best = None
        while heap:
            d, u = heapq.heappop(heap)
            if d > dist[u]:
                continue
            if best is not None and go + d * SEC_PER_MIN >= best[0]:
                break
            for tr in at.get(u, ()):
                arrive = max(go, tr["free"]) + d * SEC_PER_MIN
                if best is None or arrive < best[0] - 1e-9:
                    best = (arrive, tr)
            for v, ei in self.radj.get(u, ()):
                nd = d + self.city.edges[ei]["len"] / night.DRIVE
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    came[v] = (u, ei)
                    heapq.heappush(heap, (nd, v))
        return best, came

    def _route(self, src, target, came):
        nodes, edges, u = [src], [], src
        while u != target:
            v, ei = came[u]
            nodes.append(v)
            edges.append(ei)
            u = v
        return nodes, edges

    def _sand(self, mark):
        x, y = self.city.proj.xy(mark["lon"], mark["lat"])
        hit = set(mark.get("es") or [mark["e"]])
        for _, f in self.city.egrid.near(x, y, SAND_R + 150.0):
            pts = [self.city.proj.xy(*p) for p in self.city.edges[f]["p"]]
            if night._seg_dist(x, y, pts) <= SAND_R:
                hit.add(f)
        return sorted(hit)[:40]

    def _dispatch(self, mark, now, x, y):
        go = now + THINK
        for tr in self.trucks:
            if tr["free"] < now - IDLE_HOME_S:
                tr["node"] = tr["home"]
        target = self.drive.nearest(mark["lon"], mark["lat"])
        best, came = self._search(target, go)
        if best is None:
            return None
        tr = best[1]
        t0 = max(go, tr["free"])
        nodes, edges = self._route(tr["node"], target, came)
        tlon, tlat = self.city.nodes[target]
        if edges:
            pts, total = night._walk(self.city, nodes, edges, 0.0, night.DRIVE)
            pts = night._thin(pts, 20.0)
        else:
            pts, total = [[tlon, tlat, 0.0]], 0.0
        sand = self._sand(mark)
        sand_len = sum(self.city.edges[e]["len"] for e in sand)
        t1 = t0 + total * SEC_PER_MIN
        t2 = t1 + max(MIN_SAND_S, sand_len / night.SAND * SEC_PER_MIN)
        job = {"id": self.next_job, "c": round(now, 2), "tr": tr["id"], "m": [mark["id"]], "name": mark.get("name") or "", "near": bool(mark.get("near")),
               "lon": round(tlon, 5), "lat": round(tlat, 5), "t0": round(t0, 2), "t1": round(t1, 2), "t2": round(t2, 2),
               "q": t0 > go + 0.01, "km": round(sum(self.city.edges[e]["len"] for e in edges) / 1000.0, 2),
               "path": [[q[0], q[1], round(q[2] * SEC_PER_MIN, 2)] for q in pts],
               "sand": [[[round(p[0], 5), round(p[1], 5)] for p in self.city.edges[e]["p"]] for e in sand],
               "slen": round(sand_len), "_nodes": nodes, "_edges": edges, "_x": x, "_y": y}
        self.next_job += 1
        tr["node"], tr["free"] = target, t2
        self.jobs.append(job)
        if len(self.jobs) > 400:
            self.jobs = [j for j in self.jobs if j["t2"] > now - KEEP_JOBS_S][-400:]
        return job

    def _eta(self, job, now):
        return max(1, int(math.ceil((job["t1"] - now) / SEC_PER_MIN))) if job["t1"] > now else 0

    def _set(self, mid, act, p, job=None, now=0.0):
        s = {"act": act, "p": round(p, 2)}
        if job:
            s.update(job=job["id"], tr=job["tr"], t1=job["t1"], t2=job["t2"], min=self._eta(job, now), name=job["name"])
        self.status[mid] = s
        if len(self.status) > KEEP_STATUS:
            for k in list(self.status)[: len(self.status) - KEEP_STATUS]:
                del self.status[k]

    def handle(self, mark, p, now, prior=None):
        with self.lock:
            x, y = self.city.proj.xy(mark["lon"], mark["lat"])
            ev = {"t": round(now, 2), "id": mark["id"], "k": mark["k"], "name": mark.get("name") or "", "near": bool(mark.get("near")),
                  "pr": round(p if prior is None else prior, 2), "p0": round(p, 2), "p": round(p, 2), "lon": round(mark["lon"], 5), "lat": round(mark["lat"], 5)}
            self.waiting = [w for w in self.waiting if w["t"] > now - CONFIRM_S]
            if mark["k"] == "dry":
                ev["act"] = "clear"
                self.waiting = [w for w in self.waiting if math.hypot(w["x"] - x, w["y"] - y) > MERGE_M]
                self._set(mark["id"], "clear", p)
            else:
                close = [w for w in self.waiting if math.hypot(w["x"] - x, w["y"] - y) <= MERGE_M]
                for w in close:
                    if w["e"] != mark.get("e"):
                        p = reports.observe(p, w["k"])
                p = min(0.99, p)
                ev["p"] = round(p, 2)
                if close:
                    ev["with"] = len(close)
                if p < GO_P:
                    ev["act"] = "wait"
                    self.waiting.append({"id": mark["id"], "k": mark["k"], "e": mark.get("e"), "x": x, "y": y, "t": now})
                    self._set(mark["id"], "wait", p)
                else:
                    ids = [w["id"] for w in close] + [mark["id"]]
                    self.waiting = [w for w in self.waiting if w not in close]
                    twin = next((j for j in reversed(self.jobs) if j["t2"] > now and math.hypot(j["_x"] - x, j["_y"] - y) <= MERGE_M), None)
                    if twin:
                        twin["m"].extend(ids)
                        job, ev["act"] = twin, "join"
                    else:
                        job = self._dispatch(mark, now, x, y)
                        if job:
                            job["m"] = ids
                        ev["act"] = "go" if job else "wait"
                    if job:
                        ev.update(job=job["id"], tr=job["tr"], min=self._eta(job, now), q=job["q"])
                    for mid in ids:
                        self._set(mid, ev["act"] if mid == mark["id"] else "go", p, job, now)
            self.feed.append(ev)
            self.feed = self.feed[-KEEP_FEED:]
            self.version += 1
            return ev

    def export(self, now):
        with self.lock:
            jobs = [j for j in self.jobs if j["t2"] > now - KEEP_JOBS_S]
            base = {}
            for j in jobs:
                base.setdefault(j["tr"], j["_nodes"][0])
            trucks = []
            for tr in self.trucks:
                lon, lat = self.city.nodes[base.get(tr["id"], tr["node"])]
                trucks.append([tr["id"], round(lon, 5), round(lat, 5)])
            return {"v": self.version, "now": round(now, 2), "spm": SEC_PER_MIN, "trucks": trucks,
                    "jobs": [{k: v for k, v in j.items() if not k.startswith("_")} for j in jobs],
                    "feed": list(reversed(self.feed[-40:]))}

    def export_feed(self, now):
        with self.lock:
            return {"v": self.version, "now": round(now, 2), "spm": SEC_PER_MIN, "status": dict(self.status),
                    "feed": [{k: e[k] for k in ("t", "id", "k", "name", "act", "p", "tr", "min") if k in e} for e in reversed(self.feed[-12:])]}
