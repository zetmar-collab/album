// Konwersja assets/icon.png -> assets/icon.ico (wymagane przez electron-builder).
const fs = require('fs');
const path = require('path');
const png2icons = require('png2icons');

const png = fs.readFileSync(path.join(__dirname, 'assets', 'icon.png'));
const ico = png2icons.createICO(png, png2icons.BICUBIC, 0, true);
if (!ico) {
  console.error('Nie udało się utworzyć pliku ICO');
  process.exit(1);
}
fs.writeFileSync(path.join(__dirname, 'assets', 'icon.ico'), ico);
console.log('icon.ico zapisany,', ico.length, 'bajtów');
