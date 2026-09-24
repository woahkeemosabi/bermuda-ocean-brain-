import { get, put } from '@vercel/blob';

export const AIS_SNAPSHOT_PATH = 'ocean-brain/ais/bermuda-latest.json';

export async function readAisSnapshot() {
  const result = await get(AIS_SNAPSHOT_PATH, { access: 'private', useCache: false });
  if (!result) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

export async function writeAisSnapshot(snapshot) {
  await put(AIS_SNAPSHOT_PATH, JSON.stringify(snapshot), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
}
