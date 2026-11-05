'use strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch z limitem czasu i jednym ponowieniem przy 503/429 (MusicBrainz limituje do ok. 1 zapytania/s,
 * Discogs do 60/min). Błąd czasu zwraca czytelny komunikat zamiast wisieć kilka minut.
 */
async function fetchRetry(url, options = {}, cfg = {}) {
  const { timeout = 15000, retries = 1, retryDelay = 1200, fetchImpl } = cfg;
  const doFetch = fetchImpl || globalThis.fetch;
  let attempt = 0;
  for (;;) {
    let res;
    try {
      res = await doFetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw new Error('przekroczono czas oczekiwania (' + Math.round(timeout / 1000) + ' s)');
      }
      throw e;
    }
    if ((res.status === 503 || res.status === 429) && attempt < retries) {
      attempt++;
      const retryAfter = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, 4000) : retryDelay);
      continue;
    }
    return res;
  }
}

module.exports = { fetchRetry };
