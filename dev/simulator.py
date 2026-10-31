#!/usr/bin/env python3
"""Simulates a drive scenario, writing raw vehicle state to dev/state.json.

Scenario loops: idle -> launch 1st-4th -> cruise -> brake+corner -> idle.
Values are in the same units the (mock) CMU dbus would report.
"""
import json, math, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("GAUGES_SIM_STATE", os.path.join(HERE, "state.json"))

REDLINE = 7200

def clamp(v, lo, hi): return max(lo, min(hi, v))

def scenario(t):
    """Return dict of vehicle state at scenario time t (seconds)."""
    cyc = t % 32.0
    s = dict(speed_kmh=0.0, rpm=800, gear=0, brake=0, throttle=0.0,
             steer=0.0, lat=0.0, lon=0.0, coolant=20.0, oil=20.0)
    if cyc < 4:                                   # idle in neutral
        s.update(rpm=int(800 + 30 * math.sin(t * 2)), gear=0)
    elif cyc < 16:                                # launch through gears 1-4
        gt = cyc - 4
        gear = min(4, int(gt // 3) + 1)
        phase = gt % 3
        if phase < 2.6:                           # pull to redline
            k = phase / 2.6
            s["rpm"] = int(2800 + (REDLINE - 2800) * k)
            s["throttle"] = 100.0
            s["lon"] = 0.45 * (1 - k * 0.6)
        else:                                     # shift
            s["rpm"] = 3200
            s["throttle"] = 0.0
            gear = min(4, gear + 1)
        base = [0, 18, 38, 62, 88][gear]
        s["speed_kmh"] = base + (s["rpm"] - 2800) / (REDLINE - 2800) * 22
        s["gear"] = gear
    elif cyc < 22:                                # cruise 100 km/h
        s.update(speed_kmh=100 + 2 * math.sin(t), rpm=3400, gear=5,
                 throttle=18 + 3 * math.sin(t * 0.8))
    elif cyc < 26:                                # brake into a corner
        k = (cyc - 22) / 4
        s.update(speed_kmh=100 - 55 * k, rpm=int(3400 - 1400 * k), gear=3,
                 brake=1 if k < 0.7 else 0, throttle=0.0, lon=-0.75 * (1 - k))
        s["steer"] = 180 * k
        s["lat"] = 0.9 * k
    elif cyc < 29:                                # apex -> exit
        k = (cyc - 26) / 3
        s.update(speed_kmh=45 + 25 * k, rpm=int(2200 + 1800 * k), gear=3,
                 throttle=40 + 60 * k, steer=180 * (1 - k),
                 lat=0.9 * (1 - k * 0.8), lon=0.3 * k)
    else:                                         # roll to stop
        k = (cyc - 29) / 3
        s.update(speed_kmh=70 * (1 - k), rpm=int(3000 - 2200 * k), gear=2,
                 brake=1, lon=-0.3)

    # Coolant/oil warm-up: a slow asymptotic curve over wall-clock time (t),
    # independent of the repeating drive cycle — real engines take minutes,
    # not seconds, to reach operating temperature. Starts near a cold-soak
    # ambient and settles near typical SkyActiv operating temps. Oil lags
    # coolant, same as a real engine (oil warms via contact with hot metal,
    # not directly from combustion).
    coolant = 20 + 70 * (1 - math.exp(-t / 180.0))
    oil = 20 + 75 * (1 - math.exp(-(max(0, t - 30)) / 240.0))
    s["coolant"] = round(coolant, 1)
    s["oil"] = round(oil, 1)
    return s

def main():
    print("simulator: writing %s (Ctrl-C to stop)" % OUT)
    t0 = time.time()
    while True:
        s = scenario(time.time() - t0)
        tmp = OUT + ".tmp"
        with open(tmp, "w") as f:
            json.dump(s, f)
        os.replace(tmp, OUT)
        time.sleep(0.05)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
