// Your play session: your recent games from Karasu's public stats API, grouped into a session.
// Used by the popup (session tracker) and by content.js (which keeps the cached copy fresh while
// karasu.live is open). One request returns both the Elo changes and the HLTV ratings.
(() => {
  const API = "https://api.karasu.live/v1/graphql";
  const QUERY = `query ($s: bigint!) {
    e: v_player_elo(where: { player_steam_id: { _eq: $s } }, order_by: { match_created_at: desc }, limit: 30) {
      match_id match_created_at match_result elo_change current_elo updated_elo }
    h: v_player_match_map_hltv(where: { steam_id: { _eq: $s } }, order_by: { match: { started_at: desc_nulls_last } }, limit: 60) {
      match_id hltv_rating rounds_played } }`;
  const KEY = "sessionCache";  // chrome.storage.local: { steam, t: fetched at, games }
  const GAP = 3 * 3600e3;      // games started less than 3 hours apart belong to the same session
  const FRESH = 2 * 60e3;      // refetch at most every 2 minutes

  // Newest first: [{ id, t, win, d, pre, post, h (HLTV or null), n (rounds) }]
  async function fetchGames(steam) {
    const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { s: String(steam) } }) });
    const data = (await res.json())?.data;
    if (!data?.e) throw new Error("no data");
    const maps = new Map(); // match ID -> [rating × rounds, rounds] (a match can have several maps)
    for (const m of data.h || []) {
      const r = Number(m.hltv_rating), n = Number(m.rounds_played) || 1;
      if (!Number.isFinite(r)) continue;
      const a = maps.get(m.match_id) || [0, 0];
      a[0] += r * n; a[1] += n;
      maps.set(m.match_id, a);
    }
    return data.e.filter((g) => Number.isFinite(g.elo_change) && g.match_created_at).map((g) => {
      const m = maps.get(g.match_id);
      return { id: g.match_id, t: Date.parse(g.match_created_at), win: g.match_result === "win",
        d: g.elo_change, pre: g.current_elo, post: g.updated_elo,
        h: m ? Math.round((m[0] / m[1]) * 100) / 100 : null, n: m ? m[1] : 0 };
    });
  }

  // The latest session: the newest game plus every earlier one with less than GAP before the next.
  function session(games, now = Date.now()) {
    if (!games?.length) return null;
    const out = [games[0]];
    for (let i = 1; i < games.length && out[out.length - 1].t - games[i].t < GAP; i++) out.push(games[i]);
    out.reverse(); // oldest first
    const last = out[out.length - 1];
    const rated = out.filter((g) => g.h !== null);
    const rounds = rated.reduce((s, g) => s + (g.n || 1), 0);
    return {
      games: out,
      today: new Date(last.t).toDateString() === new Date(now).toDateString(),
      live: now - last.t < GAP, // still going: your last game started under 3 hours ago
      net: out.reduce((s, g) => s + g.d, 0),
      w: out.filter((g) => g.win).length,
      l: out.filter((g) => !g.win).length,
      hltv: rounds ? rated.reduce((s, g) => s + g.h * (g.n || 1), 0) / rounds : null,
      start: out[0].pre ?? out[0].post - out[0].d,
      end: last.post ?? last.pre + last.d,
    };
  }

  // Cached games, refreshed when older than FRESH (or when force is set). Calls back once with the
  // cache (if any) and again after a successful fetch. Failing fetches keep the cache.
  function load(steam, cb, force) {
    if (!steam) { cb(null); return; }
    chrome.storage.local.get({ [KEY]: null }, async (v) => {
      const c = v[KEY]?.steam === String(steam) ? v[KEY] : null;
      if (c) cb(c);
      if (c && !force && Date.now() - c.t < FRESH) return;
      try {
        const fresh = { steam: String(steam), t: Date.now(), games: await fetchGames(steam) };
        try { chrome.storage.local.set({ [KEY]: fresh }); } catch { /* extension reloaded */ }
        cb(fresh);
      } catch { if (!c) cb(null); }
    });
  }

  globalThis.KarasuSession = { fetchGames, session, load, KEY, GAP, FRESH };
})();
