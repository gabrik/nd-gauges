# SPDX-License-Identifier: GPL-3.0-or-later
"""Deterministic fabricated drive, inspired by gabrik/nd-gauges dev/simulator.py.

Engineering values are encoded using meters/js/data.js and docs/13-gauges.md.
This is a development fixture, not a calibration source or a physics model.
"""
import math

G = 9.80665
RATIOS = (0, 5.087, 2.991, 2.035, 1.594, 1.286, 1)
FAST = {
    'VehicleSpeed': 'Veh_V_ActlEng',
    'EngineSpeed': 'EngAout_N_Actl',
    'AccelPedalPosition': 'ApedPos_Pc_ActlArb',
    'LongitudinalAccelerometer': 'VehLong_A_Actl',
    'LateralAcceleration': 'Lateral_Acceleration',
}
SLOW = ('EngClnt_Te_Actl', 'DR_IntakeAirTemp', 'Out-CarTemperature',
        'YawRate', 'BrakePressure', 'FuelGaugePosition', 'DR_Slope')
TRIP = ('PID_Drv1Dstnc_curr', 'Drv1AvlFuelE')


def raw_state(seconds):
    """A 28-second loop: idle, pull/shift, cruise, brake, corner, stop."""
    t = seconds % 28
    speed, gear, throttle, longitudinal, lateral = 0, 0, 0, 0, 0
    if 4 <= t < 12:
        p = (t - 4) % 2
        gear = min(4, int((t - 4) // 2) + 1)
        speed = 10 + (t - 4) * 10
        throttle = 100 if p < 1.7 else 0
        longitudinal = 0.35 if throttle else 0
    elif 12 <= t < 16:
        speed, gear, throttle = 90, 4, 20
    elif 16 <= t < 20:
        speed, gear, longitudinal = 90 - (t - 16) * 12, 3, -0.6
    elif 20 <= t < 24:
        speed, gear, throttle = 42, 3, 30
        lateral = 0.8 * math.sin((t - 20) * math.pi / 4)
    elif t >= 24:
        speed, gear, longitudinal = 42 * (28 - t) / 4, 2, -0.3
    rpm = max(800, speed * RATIOS[gear] * 2.866 * 60 / (1.89 * 3.6))
    return {
        'VehicleSpeed': round(speed * 100),
        'EngineSpeed': round(rpm / 2),
        'AccelPedalPosition': round(throttle * 10),
        'LongitudinalAccelerometer': round(4000 + longitudinal * G * 100),
        'LateralAcceleration': round(4000 - lateral * G * 100),
        'EngClnt_Te_Actl': 125,
        'DR_IntakeAirTemp': 71,
        'Out-CarTemperature': 57,
        'YawRate': round((75 - (lateral * G / (speed / 3.6) * 180 / math.pi if speed else 0)) / 0.03663),
        'BrakePressure': 152,  # scale unknown: do not simulate pedal percentage here
        'FuelGaugePosition': 120,
        'DR_Slope': 32,  # scale unknown
        'PID_Drv1Dstnc_curr': 26,
        'Drv1AvlFuelE': 37,
    }


def fixture_text(seconds):
    """dbus-monitor and smdb-read text consumed by the unchanged collector."""
    return encode(raw_state(seconds))


def encode(state):
    signals = []
    # Speed last: its signal triggers a coherent collector snapshot.
    for field in (*tuple(k for k in FAST if k != 'VehicleSpeed'), 'VehicleSpeed'):
        if field not in state:
            continue
        signals.extend((
            'signal sender=:1.14 -> dest=(null destination) serial=1 '
            'path=/com/jci/vbs/vdt; interface=com.jci.vbs.vdt; member=' + FAST[field],
            '   uint16 ' + str(state[field]),
        ))
    def smdb(fields):
        return ''.join(f'{name} (int, 4): {state[name]}\n' for name in fields if name in state)
    return {'signals.txt': '\n'.join(signals) + '\n',
            'cvd.txt': smdb(SLOW), 'vdm.txt': smdb(TRIP)}
