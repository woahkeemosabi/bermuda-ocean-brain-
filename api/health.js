export default function handler(req, res) {
  res.status(200).json({ ok: true, app: 'Bermuda Ocean Brain', runtime: 'Vercel' });
}
