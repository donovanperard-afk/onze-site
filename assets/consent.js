(() => {
  'use strict';
  const ROOT = new URL('../', document.currentScript.src).href;
  // Configuration analytics (privacy-friendly). Leave endpoint empty until an account exists.
  // GoatCounter: endpoint = 'https://VOTRECODE.goatcounter.com/count', src = 'https://gc.zgo.at/count.js' (to self-host or allow in CSP).
  const ANALYTICS = { provider: 'goatcounter', endpoint: '', src: '' };
  const KEY = 'onze-consent';
  const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && (v.analytics === true || v.analytics === false) ? v : null; } catch (e) { return null; } };
  const write = analytics => { try { localStorage.setItem(KEY, JSON.stringify({ analytics, at: new Date().toISOString() })); } catch (e) {} };
  let loaded = false;
  function loadAnalytics() {
    if (loaded || !ANALYTICS.endpoint || !ANALYTICS.src) return; // nothing is requested unless configured AND consented
    loaded = true;
    const s = document.createElement('script');
    s.async = true; s.src = ANALYTICS.src; s.dataset.goatcounter = ANALYTICS.endpoint;
    document.head.appendChild(s);
  }
  let box;
  function close() { if (box) { box.remove(); box = null; } }
  function choose(value) { write(value); if (value) loadAnalytics(); close(); document.dispatchEvent(new CustomEvent('consent:change', { detail: { analytics: value } })); }
  function open() {
    if (box) return;
    box = document.createElement('section');
    box.className = 'consent';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Préférences cookies');
    box.innerHTML = '<p>Ce site ne dépose aucun cookie de suivi sans votre accord. Accepter permet de mesurer l’audience de façon anonyme. <a href="' + ROOT + 'confidentialite/">En savoir plus</a></p><div class="consent-actions"><button type="button" data-choice="no">Refuser</button><button type="button" data-choice="yes">Accepter</button></div>';
    box.querySelectorAll('[data-choice]').forEach(b => b.addEventListener('click', () => choose(b.dataset.choice === 'yes')));
    document.body.appendChild(box);
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-cookie-prefs]')) { close(); open(); } });
  const saved = read();
  if (saved === null) open(); else if (saved.analytics) loadAnalytics();
  window.onzeConsent = { get: read, open };
})();
