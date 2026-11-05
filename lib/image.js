'use strict';

/**
 * Rozpoznaje format obrazu po sygnaturze (magic bytes), a nie po nazwie czy nagłówku Content-Type.
 * Zwraca rozszerzenie z kropką albo null, gdy to nie jest obsługiwany obraz.
 */
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  if (buf.subarray(0, 3).toString('latin1') === 'GIF') return '.gif';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return '.bmp';
  return null;
}

module.exports = { sniffImage };
