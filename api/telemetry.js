const LAT = 32.3078;
const LON = -64.7505;
const ANNUAL_REFERENCE_GWH = 616;
const AVERAGE_MW = (ANNUAL_REFERENCE_GWH * 1000) / 8760;

function bermudaHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Atlantic/Bermuda',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === 'hour')?.value || 12);
}

function modeledDemandMW(hour) {
  // A transparent diurnal model anchored to the 2018 IRP's 2026 system-load
  // reference. This is intentionally labelled MODEL in the client until a live
  // BELCO system-demand feed is available.
  const morning = 0.10 * Math.exp(-Math.pow((hour - 8.5) / 3.2, 2));
  const evening = 0.18 * Math.exp(-Math.pow((hour - 19.5) / 3.6, 2));
  const overnightDip = 0.15 * Math.exp(-Math.pow((hour - 3.5) / 3.4, 2));
  const factor = 0.94 + morning + evening - overnightDip;
  return Math.max(49, Math.min(88, AVERAGE_MW * factor));
}

function conditionFromCode(code) {
  if (code === 0) return 'Clear';
  if ([1, 2].includes(code)) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if ([45, 48].includes(code)) return 'Fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
  if ([95, 96, 99].includes(code)) return 'Thunderstorms';
  return 'Live';
}

export default async function handler(req, res) {
  const now = new Date();
  const hour = bermudaHour(now);
  const power = {
    estimatedMW: Number(modeledDemandMW(hour).toFixed(1)),
    annualReferenceGWh: ANNUAL_REFERENCE_GWH,
    live: false,
    source: 'Bermuda IRP 2026 reference model',
  };

  let weather = null;
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(LAT));
    url.searchParams.set('longitude', String(LON));
    url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m');
    url.searchParams.set('wind_speed_unit', 'kn');
    url.searchParams.set('timezone', 'Atlantic/Bermuda');
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (response.ok) {
      const data = await response.json();
      const current = data?.current || {};
      weather = {
        temperatureC: Number(current.temperature_2m),
        windKn: Number(current.wind_speed_10m),
        windDirectionDeg: Number(current.wind_direction_10m),
        windGustKn: Number(current.wind_gusts_10m),
        humidityPct: Number(current.relative_humidity_2m),
        precipitationMm: Number(current.precipitation),
        condition: conditionFromCode(Number(current.weather_code)),
      };
    }
  } catch (error) {
    console.warn('[telemetry] weather fetch failed', error);
  }

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=180');
  res.status(200).json({
    generatedAt: now.toISOString(),
    power,
    weather,
  });
}
