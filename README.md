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


## v20 visual cleanup
- Replaced oversized yellow aircraft glyphs with white airframe silhouettes.
- Removed aircraft heading-vector and trail clutter.
- Removed cyan GIS boundary lines; marine intelligence is now fill-first and subtle.
- Subsea cables are amber and only appear at close range.
- AIS now uses the streaming endpoint as primary with automatic EventSource reconnect and a broader Bermuda regional box.
- A connected-but-empty AIS stream displays SEA 0 rather than implying a feed failure.


## v22
- Multi-source Bermuda AIS: Open Waters snapshot + facha.dev radius + AISStream fallback.
- Open Waters native WebSocket now uses snapshot:true rather than an invalid HTTP/SSE assumption.
- Ground aircraft render smaller and are labelled GROUND.
- Marine point-speckle clutter removed; HUD/header/dock tightened on mobile.
