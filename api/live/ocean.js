export default async function handler(req, res) {
  const url = 'https://marine-api.open-meteo.com/v1/marine?latitude=32.3078&longitude=-64.7505&current=wave_height,wave_direction,wave_period,sea_surface_temperature,ocean_current_velocity,ocean_current_direction&velocity_unit=kn&timezone=Atlantic%2FBermuda';
  try {
    const upstream = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!upstream.ok) return res.status(502).json({ error: `Marine model upstream returned ${upstream.status}` });
    const data = await upstream.json();
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    res.status(200).json(data);
  } catch (error) {
    res.status(502).json({ error: 'Marine model unavailable' });
  }
}
