# Bermuda Ocean Brain — v17 cinematic rebuild

A clean rebuild of the mobile experience around the approved concept render rather than the previous GIS-control UI.

## Design contract
- Map-first cinematic 3D Bermuda world
- Automatic live aircraft and AIS vessel targets
- Type-aware target silhouettes, labels and motion trails
- Subtle Bermuda MSP reef / seagrass / shelf / territorial / cable context
- No generic map-click GIS popups
- One contextual intelligence sheet for real targets or explicit Intel
- Compact top HUD + Focus / World Live / Intel dock
- Cesium attribution kept clear and tappable below controls

## Environment
- `VITE_CESIUM_ION_TOKEN` (or legacy `VITE_CESIU_ION_TOKEN`)

The project uses Cesium ion asset 2275207 for Google Photorealistic 3D Tiles.
