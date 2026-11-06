// Shared leaderboard for King of the Gimelets.
// Needs an Upstash Redis store connected to the Vercel project
// (Storage -> Create Database -> Upstash Redis). Vercel injects the env vars.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const MAX_SCORE = 150;

async function redis(cmds) {
  const r = await fetch(URL_ + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds)
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => x.result);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!URL_ || !TOKEN) return res.status(503).json({ error: 'not_configured' });

  try {
    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') b = JSON.parse(b || '{}');
      b = b || {};
      const id = String(b.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 32);
      const name = String(b.name || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 14);
      const score = Math.floor(Number(b.score));
      const ch = String(b.char || '').replace(/[^a-z]/g, '').slice(0, 12);
      if (!id || !name || !Number.isFinite(score) || score < 1 || score > MAX_SCORE) {
        return res.status(400).json({ error: 'bad_request' });
      }
      await redis([
        ['ZADD', 'gm:scores', 'GT', score, id],
        ['HSET', 'gm:names', id, name],
        ['HSET', 'gm:chars', id, ch]
      ]);
    } else if (req.method !== 'GET') {
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    const [top] = await redis([['ZREVRANGE', 'gm:scores', 0, 14, 'WITHSCORES']]);
    const ids = [], scores = [];
    for (let i = 0; i < (top || []).length; i += 2) { ids.push(top[i]); scores.push(Number(top[i + 1])); }
    let names = [], chars = [];
    if (ids.length) [names, chars] = await redis([['HMGET', 'gm:names', ...ids], ['HMGET', 'gm:chars', ...ids]]);
    res.status(200).json({
      scores: ids.map((id, i) => ({ name: names[i] || 'חייל', score: scores[i], char: chars[i] || '' }))
    });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
};
