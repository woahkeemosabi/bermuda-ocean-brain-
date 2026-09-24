# Bermuda Ocean Brain — v26

Cinematic Cesium/Google 3D Bermuda intelligence interface.

## v26 AIS persistence fix
v25 proved the AISStream credential and subscription were valid, but a request-bound 12-second sample could easily receive no Bermuda position packet. v26 changes the architecture:

1. `/api/ais-collector` opens AISStream for 48 seconds.
2. Real AIS positions are merged by MMSI with the previous snapshot.
3. The snapshot is stored in a **private Vercel Blob** object.
4. Contacts remain available for 30 minutes after their most recent real AIS position.
5. `/api/ais-live` reads the persistent snapshot immediately; it no longer opens a WebSocket.
6. The browser quietly starts another collector after the previous one finishes, so this works even without a high-frequency Vercel Cron plan.
7. No simulated vessels are generated.

## Required Vercel setup
- Keep `AISSTREAM_API_KEY` configured as a server-only environment variable.
- In the `bermuda-ocean-brain` Vercel project, create/connect a **Private Blob** store. New stores use Vercel OIDC automatically; older stores may set `BLOB_READ_WRITE_TOKEN`.
- Redeploy after the Blob store is connected.

## Expected diagnostics
- `/api/ais-live` returns `pipelineVersion: "v26"`.
- `/api/ais-collector` reports `connected`, `subscriptionConfirmed`, `positionFrames`, and `retainedContacts`.
- `SEA —` now means the AIS snapshot is genuinely unavailable/configuration failed.
- A valid empty snapshot shows `SEA 0` while the collector continues sampling.

Google Photorealistic 3D uses Cesium ion asset 2275207.
