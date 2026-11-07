# CINEMA notes (append, prefix with your role)

ROCKETS: proposed launch timing (colony progress gR = clamp01((sm - CA) / (1 - CA)), the value main.js already passes to rockets.update). Choreographer, please confirm or move; the numbers live in one table in d5/rockets.js and can be overridden from the page with `D5_CFG.rocketT = { ignite, lift }`.
- 0.00-0.064 two ships land (unchanged), city build held until ARRIVE 0.1 (unchanged)
- 0.30 pad pours, 0.32-0.38 tower, 0.40-0.645 five hull bands craned in, 0.66-0.70 flaps, 0.71-0.76 scaffold drops (build compressed to make room)
- 0.80 IGNITE: engine flicker, ground glow, steam/dust start
- 0.83 LIFTOFF: plume full (shock diamonds), dust wave rolls out over the colony to ~600 m by 0.93, warm light sweep across domes and ground
- climb y(m) = 42000 * (gR - 0.83)^2 (~100 m at 0.88, ~400 m at 0.93, ~1.2 km at 1.0), slight drift downrange (+x); plume column lingers to 1.0
- camera tilt-up suggestion: start easing look.y up at 0.835, follow `rockets.launch.pos` (world) with lag, hold the column in frame from ~0.93
