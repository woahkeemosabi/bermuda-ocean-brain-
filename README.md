# Bermuda Ocean Brain — v14 GeoLibre Core Features

Mobile-first Cesium / God's Eye View Bermuda mission-control build with a compact GeoLibre-derived GIS capability layer.

## Core runtime
- Google Photorealistic 3D through Cesium ion.
- God's Eye View live-data architecture.
- Bermuda MSP / ArcGIS marine intelligence layers.
- Mobile mission-control UI with translucent layer sheet.

## Entity intelligence
- Type-aware aircraft silhouettes: airliner, cargo, business jet, prop/turboprop, helicopter.
- Common ICAO aircraft type decoding when source metadata is available.
- Type-aware vessel silhouettes: sailboat, yacht, superyacht/megayacht, cargo, tanker, fishing, tug, ferry/passenger.
- Tap-to-identify cards for aircraft, vessels and marine features.
- Identify-all uses Cesium drill-pick so overlapping visible layers can be inspected at the same map location.

## GeoLibre core capability pass
- Grouped layer catalog: Traffic, Weather, Habitats, Bathymetry, Jurisdiction, Infrastructure.
- Active layer stack with independent visibility, opacity and render ordering.
- Ocean layer style-strength presets: Soft / Standard / Bold.
- Automatic legend built from visible active layers.
- Lightweight attribute-table preview and feature counts for marine layers.
- Quick live-target filters for aircraft and vessel classes.
- Radar history selector for recent RainViewer frames.
- Spatial tools: identify, geodesic measure, 5 NM buffer/range ring, nearby mapped-feature count, clear analysis graphics.
- Semantic-zoom cleanup: denser habitat clustering and fewer large-zone labels at island scale.
- ArcGIS marine ingestion now paginates beyond the first transfer-limit page instead of silently stopping at 1,000 features.

## Camera behavior
Layer toggles never move the camera. Only the dedicated Focus control recenters Bermuda.

Exact external photos / registry imagery are intentionally not included.

See `THIRD_PARTY_NOTICES.md` for GeoLibre attribution and MIT license notice.


## v15 Auto World Mode

- Removes manual mission-layer configuration from the mobile experience.
- Automatically selects ocean layers by camera altitude (semantic zoom).
- Replaces map wind arrows with a lightweight animated screen-space flow field.
- Live traffic and marine context appear automatically; failed feeds stay out of the UI.
- Keeps tap-to-identify intelligence cards and a single compact Intel sheet.
- RainViewer radar manifest parser accepts current opaque frame IDs.
