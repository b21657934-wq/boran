import math

R_EARTH = 6371000.0


def haversine(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(a))


class Projector:
    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = math.cos(math.radians(lat0)) * 111320.0
        self.ky = 110540.0

    def xy(self, lon, lat):
        return (lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky


class Grid:
    def __init__(self, cell):
        self.cell = cell
        self.d = {}

    def add(self, x, y, item):
        self.d.setdefault((int(x // self.cell), int(y // self.cell)), []).append((x, y, item))

    def near(self, x, y, r):
        c = self.cell
        k = int(r // c) + 1
        cx, cy = int(x // c), int(y // c)
        r2 = r * r
        for i in range(cx - k, cx + k + 1):
            for j in range(cy - k, cy + k + 1):
                for px, py, item in self.d.get((i, j), ()):
                    dd = (px - x) ** 2 + (py - y) ** 2
                    if dd <= r2:
                        yield dd, item

    def nearest(self, x, y, rmax=2000.0):
        r = self.cell
        while r <= rmax:
            best = min(self.near(x, y, r), default=None, key=lambda t: t[0])
            if best:
                return best[1], math.sqrt(best[0])
            r *= 2
        return None, None
