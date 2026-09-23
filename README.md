# Bermuda Ocean Brain

Production-oriented Vercel package using the actual open-source God's Eye View runtime pinned to commit `082074a00684af97458b85529093e2b2a9f28ed1`.

## Current architecture
- God’s Eye View owns globe, HUD, camera, controls and native AIS vessel rendering.
- Vercel serves the production frontend and same-origin API facade.
- `/api/ais-live` and `/api/ais-live/track` proxy the existing Ocean Brain AIS backend so the AISStream credential stays server-side during migration.
- Bermuda MSP layers are fetched server-side and cached at Vercel’s edge.
- `VITE_GOOGLE_MAPS_API_KEY` enables Google Photorealistic 3D Tiles when configured.

## Production setup
1. Import/deploy this directory as a Vercel project.
2. Add `VITE_GOOGLE_MAPS_API_KEY` in Vercel Project Settings > Environment Variables.
3. In Google Cloud, enable Map Tiles API and restrict the key to the production Vercel/custom domain.
4. Deploy production.

The app works without the Google key using the upstream God’s Eye fallback renderer.


## Mobile v3
- Clean map on launch; marine layers are opt-in.
- Bermuda MSP subsea cable layer replaces the global TeleGeography mobile layer.
- Dense Point GeoJSON uses compact points instead of Cesium pin billboards.


## v5 mobile fixes
- Near-nadir Bermuda camera framing
- Retina render-quality tuning
- ArcGIS JSON to GeoJSON marine layer bridge
- Bermuda spatial filter for heavy cable data
