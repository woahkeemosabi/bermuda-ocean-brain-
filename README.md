# Bermuda Ocean Brain — v11 Entity Intelligence

Mobile-first Cesium/God's Eye Bermuda mission-control build.

## v11 changes
- Type-aware aircraft silhouettes: airliner, cargo, business jet, prop/turboprop, helicopter.
- Aircraft labels decode common ICAO type codes (for example B738, A320, B77W) when the live source supplies them.
- Type-aware vessel silhouettes: sailboat, yacht, superyacht/megayacht, cargo, tanker, fishing, tug, ferry/passenger.
- Vessel class heuristics use AIS type plus reported length where available.
- Tap aircraft, vessels, or Bermuda marine features for a target-intelligence card.
- Ocean Intelligence features carry their source metadata into the inspector.
- Coral, seagrass, seamount, cable, shelf/slope and boundary layers now use distinct map symbology instead of generic point dots.
- Dense coral/seagrass observations cluster with layer-specific icons and counts.
- Subsea cables use a glow line; seamounts use mountain markers; large marine zones receive readable labels.
- Ocean layer buttons report feature counts and prompt for map inspection.
- Layer toggles never move the camera; only Focus recenters Bermuda.

Exact external photos/registry imagery are intentionally not included.
