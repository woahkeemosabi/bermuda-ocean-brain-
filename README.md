# Bermuda Ocean Brain — Data Proof Build v23

This build deliberately removes the cinematic map interface. Its only purpose is to prove the upstream data before more UI work happens.

It tests:
- Open Waters AIS snapshot around Bermuda.
- facha.dev vessel radius endpoint.
- AISStream live sample using `AISSTREAM_API_KEY`.
- Multi-source ADS-B aircraft adapter.
- Bermuda MSP marine GIS endpoints and feature counts.
- Live marine/ocean conditions endpoint.

The sea table never converts an empty feed into the claim that Bermuda has zero vessels. If no source returns positions it says **NO AIS DATA RECEIVED** and exposes source-level diagnostics.
