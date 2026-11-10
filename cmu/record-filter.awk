# SPDX-License-Identifier: GPL-3.0-or-later
# Strict subset of MiatOff collector signal mapping. Output is replay JSONL,
# not a full bus dump. Timestamp prefixes come from the recording wrapper.
BEGIN {
    map["Veh_V_ActlEng"] = "VehicleSpeed"
    map["EngAout_N_Actl"] = "EngineSpeed"
    map["ApedPos_Pc_ActlArb"] = "AccelPedalPosition"
    map["VehLong_A_Actl"] = "LongitudinalAccelerometer"
    map["Lateral_Acceleration"] = "LateralAcceleration"
    n = split("EngClnt_Te_Actl DR_IntakeAirTemp Out-CarTemperature YawRate BrakePressure FuelGaugePosition DR_Slope", a, " ")
    for (i = 1; i <= n; i++) allowed[a[i]] = 1
}
/^@[0-9]+(\.[0-9]+)?$/ { stamp = substr($0, 2) + 0; have_time = 1; next }
/^signal / {
    iface = $0; sub(/.*interface=/, "", iface); sub(/;.*/, "", iface)
    member = $0; sub(/.*member=/, "", member); sub(/[ \r\t]+$/, "", member)
    name = iface == "com.jci.vbs.vdt" && (member in map) ? map[member] : ""
    next
}
name != "" && $1 == "uint16" && $2 ~ /^[0-9]+$/ && $2 + 0 <= 65535 {
    value[name] = $2 + 0
    if (name == "VehicleSpeed" && have_time) {
        if (!started) { origin = stamp; started = 1; last = -1 }
        elapsed = stamp - origin
        if (elapsed > last) {
            printf "{\"t\":%.3f,\"fields\":{", elapsed
            sep = ""
            for (k in value) { printf "%s\"%s\":%d", sep, k, value[k]; sep = "," }
            while ((getline line < slow) > 0) {
                split(line, field, "=")
                if ((field[1] in allowed) && field[2] ~ /^[0-9]+$/ && field[2] + 0 <= 65535)
                    printf ",\"%s\":%d", field[1], field[2]
            }
            close(slow)
            print "}}"
            fflush()
            last = elapsed
        }
    }
    name = ""
}
