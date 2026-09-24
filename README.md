# Bermuda Ocean Brain — v19

Cinematic Cesium/Google 3D Bermuda intelligence interface.

## v19 vessel architecture
- Removes the AppDeploy AIS dependency entirely.
- Connects server-side from Vercel directly to `wss://stream.aisstream.io/v0/stream`.
- `/api/ais-stream` relays live Bermuda AIS as Server-Sent Events for fast contact appearance.
- `/api/ais-live` provides a direct sampled JSON fallback when streaming is unavailable.
- No simulated vessels are rendered. Feed outages are reported as unavailable rather than as zero real vessels.

## Required Vercel environment variables
- `VITE_CESIUM_ION_TOKEN` (legacy `VITE_CESIU_ION_TOKEN` also accepted)
- `AISSTREAM_API_KEY` — server-only, never use a `VITE_` prefix

Google Photorealistic 3D uses Cesium ion asset 2275207.
