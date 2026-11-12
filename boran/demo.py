import math
import random

from . import config


def raw():
    rnd = random.Random(7)
    s, w, n, e = config.BBOX
    nx, ny = 26, 22
    lon = lambda i: w + (e - w) * i / (nx - 1)
    lat = lambda j: s + (n - s) * j / (ny - 1)
    nid = lambda i, j: 1000000 + j * 1000 + i
    river = lambda i: 9.5 + 3.2 * math.sin(i / 4.2) + i * 0.18
    bridges = {4, 11, 18, 23}
    roads, buildings, misc = [], [], []
    wid = 1

    def pt(i, j):
        return {"lon": lon(i) + ((i * 7 + j * 3) % 5 - 2) * 0.00012, "lat": lat(j) + ((i * 5 + j * 11) % 5 - 2) * 0.00008}

    def crosses_river(i, j0, j1):
        r = river(i)
        return j0 < r < j1

    for j in range(ny):
        hw = "primary" if j % 7 == 3 else "secondary" if j % 4 == 1 else "residential" if j % 2 else "footway"
        seg = []
        for i in range(nx):
            if abs(river(i) - j) < 0.45:
                if len(seg) > 1:
                    roads.append({"type": "way", "id": wid, "nodes": [nid(a, j) for a in seg], "geometry": [pt(a, j) for a in seg], "tags": {"highway": hw}})
                    wid += 1
                seg = []
                continue
            seg.append(i)
        if len(seg) > 1:
            roads.append({"type": "way", "id": wid, "nodes": [nid(a, j) for a in seg], "geometry": [pt(a, j) for a in seg], "tags": {"highway": hw}})
            wid += 1
    for i in range(nx):
        hw = "primary" if i % 6 == 2 else "tertiary" if i % 3 == 0 else "residential" if i % 2 else "footway"
        for j in range(ny - 1):
            tags = {"highway": hw}
            if crosses_river(i, j, j + 1):
                if i not in bridges:
                    continue
                tags = {"highway": "secondary", "bridge": "yes"}
            if abs(river(i) - j) < 0.45 or abs(river(i) - (j + 1)) < 0.45:
                if i not in bridges:
                    continue
                tags = {"highway": "secondary", "bridge": "yes"}
            roads.append({"type": "way", "id": wid, "nodes": [nid(i, j), nid(i, j + 1)], "geometry": [pt(i, j), pt(i, j + 1)], "tags": tags})
            wid += 1
    dlon, dlat = (e - w) / (nx - 1), (n - s) / (ny - 1)
    for j in range(ny - 1):
        for i in range(nx - 1):
            if abs(river(i + 0.5) - (j + 0.5)) < 1.1:
                continue
            central = math.hypot(i - 9, j - 17) < 6 or math.hypot(i - 5, j - 5) < 4
            for a in range(2):
                for b in range(2):
                    if rnd.random() < (0.18 if central else 0.4):
                        continue
                    cx = lon(i) + dlon * (0.2 + 0.6 * a) + (rnd.random() - 0.5) * dlon * 0.08
                    cy = lat(j) + dlat * (0.2 + 0.6 * b) + (rnd.random() - 0.5) * dlat * 0.08
                    hx = dlon * (0.07 + rnd.random() * 0.08)
                    hy = dlat * (0.07 + rnd.random() * 0.08)
                    lv = int(rnd.choice([9, 12, 16, 22, 25, 30]) if central and rnd.random() < 0.6 else rnd.choice([2, 3, 5, 5, 9, 9, 12]))
                    ring = [(cx - hx, cy - hy), (cx + hx, cy - hy), (cx + hx, cy + hy), (cx - hx, cy + hy), (cx - hx, cy - hy)]
                    buildings.append({"type": "way", "id": wid, "geometry": [{"lon": x, "lat": y} for x, y in ring], "tags": {"building": "yes", "building:levels": str(lv)}})
                    wid += 1
    misc.append({"type": "way", "id": wid, "geometry": [{"lon": lon(i / 2), "lat": lat(river(i / 2))} for i in range(0, (nx - 1) * 2 + 1)], "tags": {"waterway": "river"}})
    wid += 1
    k = 0
    for j in range(ny):
        for i in range(nx):
            if (j % 7 == 3 or i % 6 == 2) and (i + j) % 3 == 0 and abs(river(i) - j) > 0.8:
                p = pt(i, j)
                misc.append({"type": "node", "id": 5000000 + k, "lon": p["lon"] + 0.0002, "lat": p["lat"] + 0.0001, "tags": {"highway": "bus_stop", "name": f"Остановка {k + 1}"}})
                k += 1
    for name, i, j in [("ТРЦ «Демо-1»", 9, 17), ("ТРЦ «Демо-2»", 5, 6), ("ТРЦ «Демо-3»", 19, 15), ("ТРЦ «Демо-4»", 14, 4)]:
        p = pt(i, j)
        misc.append({"type": "node", "id": 6000000 + i, "lon": p["lon"] + 0.0004, "lat": p["lat"] + 0.0003, "tags": {"shop": "mall", "name": name}})
    for c in range(40):
        i, j = rnd.randrange(nx), rnd.randrange(ny)
        if abs(river(i) - j) < 0.8:
            continue
        p = pt(i, j)
        misc.append({"type": "node", "id": 7000000 + c, "lon": p["lon"] - 0.0003, "lat": p["lat"] + 0.0002, "tags": {"amenity": "cafe", "name": f"Кафе {c + 1}"}})
    return {"roads": roads, "buildings": buildings, "misc": misc}
