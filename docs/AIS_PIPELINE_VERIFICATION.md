# AIS pipeline repair and verification

Baseline: GitHub `ab3d05ade15f28a557f040ae39e73d43f340aede`; production deployment `dpl_DNYZLniUf5F4ERa9ehDsF9wPksNz`. Observed 24 September 2026, approximately 17:41–17:45 UTC.

## Reproduced failures

- `/api/ais-live?diagnostic=1`: HTTP 200, no rows. Open Waters: empty snapshot. facha.dev: HTTP 400. AISStream: socket opened, zero frames in 12 seconds, incorrectly labelled successful.
- Direct facha.dev response to the configured 100 km request: `Radius cannot be greater than 30km`. Corrected 30 km Bermuda request: HTTP 200, empty array.
- Independent positive controls: facha.dev Lisbon 30 km returned 97 rows; Open Waters Oslo returned 503 raw GeoJSON features. These were reference checks, not Bermuda vessels. The latter includes aids to navigation, which the vessel adapter must exclude.
- Existing `/api/ais-stream`: facha.dev HTTP 400 followed by Open Waters `live` status and heartbeats, without any vessel events. A silent open stream prevented the AISStream fallback from ever running.
- Code accepted `null` numbers as zero and replaced missing/unparseable source timestamps with now. Those conversions could manufacture coordinates, speed, heading, and freshness.

## Repair scope

The current diagnostic layout and stylesheet are preserved. Shared adapters serve snapshot, streaming, and track routes. The accepted 30 km facha radius is explicit; the other providers retain their Bermuda bounding box. Snapshot requests run independently; streams run concurrently and close within the configured Vercel duration. Success requires data or an accepted subscription, not a socket opening. HTTP error details, early closes, malformed records, source age, unknown values, and invalid AIS sentinel values are handled explicitly. Source timestamps are never invented. Static metadata can enrich an existing row without changing its position time.

`/api/ais-live?diagnostic=1&control=1` is a read-only, bounded provider test: Oslo snapshot, Lisbon snapshot, global AISStream (at most 12 seconds, stopping after three distinct positions). Its `rows` is always empty and its scope is `reference-only`. It is never used by the Bermuda page. A successful reference check does not prove Bermuda receiver coverage.

## Gates

1. `npm test`: 13 regression/contract tests using labelled test fixtures, not live data.
2. `npm run build`: production Vite build.
3. `npm exec tsc -- --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --lib ES2022,DOM --types vite/client src/main.ts src/aisDisplay.ts`: changed frontend code.
4. Baseline full-project typecheck already fails in unused `src/oceanBrainMarineLayers.ts:302` (`GeoJsonDataSource.destroy`). This unrelated file is outside this repair.
5. Verify the deployed commit and READY state, then run `node scripts/verify-ais.mjs <deployment-url>` and `node scripts/verify-ais.mjs <deployment-url> --control`.
6. Inspect `/api/ais-stream` for status and vessel events; verify cleanup and bounded completion. Inspect track validation (HTTP 400 for invalid MMSI).
7. Open the deployed page, inspect actual AIS rows/diagnostics and app console errors; confirm CSS is unchanged.
8. Repeat production URL/commit/API/browser checks after promotion. Do not claim fresh Bermuda vessel delivery unless a real Bermuda position arrives with a source timestamp. Exit 2 from the verification script explicitly means this data gate is unproven, even when the HTTP and build gates pass.

## Provider references

- Open Waters API: https://openwaters.io/api/ais/ (latitude/longitude box order, point features, source attribution, bounded snapshots).
- AISStream: https://aisstream.io/documentation (server-side keys, SubscriptionConfirmation, permessage-deflate, binary UTF-8 messages, connection limits).
- facha radius limit was verified from the live provider's HTTP 400 JSON body, then an HTTP 200 request at 30 km.

Runtime log inspection through the Vercel connector returned a permissions error during baseline investigation; the public API responses and browser diagnostics are the evidence above.

## Current delivery status

The repaired code passed all 13 tests, the changed-frontend TypeScript check and the production build locally. `src/styles.css` is byte-identical to the baseline. Publishing the repair was blocked: GitHub's create-tree operation returned HTTP 403, `Resource not accessible by integration`. No repaired preview or production deployment has been created. The existing production site remains on the baseline commit. The AISStream global control, repaired deployed streaming endpoint and production browser checks are therefore pending. Fresh Bermuda vessel delivery has not been proven.

This patch targets the existing `woahkeemosabi/bermuda-ocean-brain-` repository. Restore write access to that repository's GitHub connection to continue with a preview on the existing `bermuda-ocean-brain` Vercel project. Do not create another Vercel project or treat a READY build as proof of vessel delivery.
