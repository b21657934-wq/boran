import datetime as dt

import requests

from . import config

URL = "https://api.open-meteo.com/v1/forecast"
PAST, AHEAD = 12, 6


def _hour(time, temp, app, precip, snow, wind, wdir, hum):
    return {"time": time, "temp": temp, "apparent": app, "precip": precip, "snow": snow, "wind": wind, "wdir": wdir, "hum": hum}


def fetch_live():
    lat, lon = config.CITY
    params = {
        "latitude": lat, "longitude": lon, "timezone": config.TZ, "wind_speed_unit": "ms",
        "past_days": 1, "forecast_days": 2,
        "hourly": "temperature_2m,apparent_temperature,precipitation,snowfall,wind_speed_10m,wind_direction_10m,relative_humidity_2m",
        "current": "temperature_2m,apparent_temperature,precipitation,snowfall,wind_speed_10m,wind_direction_10m,relative_humidity_2m,is_day",
    }
    r = requests.get(URL, params=params, timeout=12)
    r.raise_for_status()
    return parse(r.json())


def parse(js):
    hz = js["hourly"]
    cur = js["current"]
    now_key = cur["time"][:13]
    idx = max((i for i, t in enumerate(hz["time"]) if t[:13] <= now_key), default=len(hz["time"]) - 1)
    val = lambda key, i: float(hz[key][i]) if hz[key][i] is not None else 0.0

    def hour(i):
        return _hour(hz["time"][i][11:16], val("temperature_2m", i), val("apparent_temperature", i), val("precipitation", i),
                     val("snowfall", i), val("wind_speed_10m", i), val("wind_direction_10m", i), val("relative_humidity_2m", i))

    lo = max(0, idx - PAST + 1)
    past = [hour(i) for i in range(lo, idx + 1)]
    ahead = [hour(i) for i in range(idx + 1, min(len(hz["time"]), idx + 1 + AHEAD))]
    now = _hour(cur["time"][11:16], float(cur["temperature_2m"]), float(cur["apparent_temperature"]), float(cur.get("precipitation") or 0),
                float(cur.get("snowfall") or 0), float(cur["wind_speed_10m"]), float(cur["wind_direction_10m"]), float(cur["relative_humidity_2m"]))
    past[-1] = dict(now, time=past[-1]["time"])
    return {"source": "live", "now": now, "past": past, "ahead": ahead, "night": not bool(cur.get("is_day", 1)), "date": cur["time"][:10]}


def _series(temps, snow, wind, wdir=250, hum=82, start_hour=20):
    out = []
    for i, t in enumerate(temps):
        w = wind[i]
        app = t - 0.9 * w if t < 5 else t
        hh = (start_hour + i) % 24
        out.append(_hour(f"{hh:02d}:00", float(t), round(app, 1), float(snow[i]), float(snow[i]), float(w), float(wdir), float(hum)))
    return out


SCENARIOS = {
    "thaw_freeze": dict(temps=[3, 4, 4, 3, 2, 1, 0, -2, -4, -6, -8, -9, -10, -10, -11, -11, -12, -12],
                        snow=[0, 0, 0.3, 0.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                        wind=[3, 3, 4, 4, 4, 5, 5, 6, 6, 5, 5, 4, 4, 4, 3, 3, 3, 3], start=20, night=False),
    "blizzard": dict(temps=[-12, -12, -13, -13, -14, -14, -15, -15, -15, -16, -16, -16, -16, -15, -15, -14, -14, -13],
                     snow=[0.5, 0.8, 1, 1.2, 1.5, 1.5, 2, 2, 1.8, 1.5, 1.5, 1.6, 1.2, 0.9, 0.6, 0.4, 0.2, 0.1],
                     wind=[8, 9, 11, 12, 14, 15, 16, 17, 18, 18, 18, 18, 16, 13, 11, 9, 8, 7], start=8, night=True),
    "clear_frost": dict(temps=[-31, -32, -33, -33, -34, -34, -35, -35, -35, -35, -34, -35, -34, -33, -32, -31, -30, -29],
                        snow=[0] * 18, wind=[2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3], start=20, night=False),
    "snow_after_thaw": dict(temps=[2, 2, 1, 0, -1, -2, -3, -4, -4, -5, -5, -6, -6, -7, -7, -8, -8, -8],
                            snow=[0.2, 0.3, 0, 0, 0, 0.5, 0.8, 1, 1, 0.8, 0.5, 0.3, 0.3, 0.2, 0.1, 0, 0, 0],
                            wind=[4, 4, 5, 5, 6, 7, 7, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 4], start=6, night=True),
}


def scenario(name):
    sc = SCENARIOS[name]
    hours = _series(sc["temps"], sc["snow"], sc["wind"], start_hour=sc["start"])
    past, ahead = hours[:PAST], hours[PAST:]
    return {"source": name, "now": dict(past[-1]), "past": past, "ahead": ahead, "night": sc["night"], "date": ""}


def get(name="live"):
    if name != "live" and name in SCENARIOS:
        return scenario(name)
    try:
        return fetch_live()
    except Exception:
        w = scenario("thaw_freeze")
        w["fallback"] = True
        return w
