'use strict';

const { fetchRetry } = require('./net');

/** "v1.2.3" / "1.2" -> [1,2,3]; null przy nieprawidłowym zapisie. */
function parseVersion(v) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : null;
}

function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/**
 * Pyta GitHub o najnowsze wydanie. Niczego nie pobiera ani nie instaluje - zwraca tylko informację
 * i adres strony wydania (musi należeć do tego repozytorium), którą użytkownik otwiera sam.
 */
async function checkLatest({ repo, current, fetchImpl, timeout = 10000 }) {
  const res = await fetchRetry(
    'https://api.github.com/repos/' + repo + '/releases/latest',
    { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AlbumApp-update-check' } },
    { fetchImpl, timeout, retries: 0 }
  );
  if (res.status === 404) return { updateAvailable: false, latest: null, url: null };
  if (!res.ok) throw new Error('GitHub: HTTP ' + res.status);
  const data = await res.json();
  const tag = String((data && data.tag_name) || '');
  const url = String((data && data.html_url) || '');
  if (!parseVersion(tag)) throw new Error('Nieprawidłowy numer wersji w odpowiedzi GitHuba.');
  if (!url.startsWith('https://github.com/' + repo + '/releases/')) throw new Error('Nieoczekiwany adres wydania.');
  return {
    updateAvailable: isNewer(tag, current),
    latest: tag.replace(/^v/, ''),
    url,
    name: String((data && data.name) || tag)
  };
}

module.exports = { parseVersion, isNewer, checkLatest };
