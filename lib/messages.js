'use strict';

// Wspólny dostęp do tłumaczeń dla procesu głównego i modułów lib. Rejestruje słowniki i oddaje funkcję t().
// Język ustawia main.js (i18n.setLang); w testach domyślnie obowiązuje polski.
const i18n = require('../renderer/i18n');

i18n.register('pl', require('../renderer/lang-pl'));
i18n.register('en', require('../renderer/lang-en'));
i18n.register('en', require('../renderer/lang-en-ui'));

module.exports = i18n;
