/* Page UI: nav, reveals, drawers (contact + Webdesigner waitlist), copy, smooth scroll.
   Exposes window.siteUI for the hand-gesture code in app.js. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── toast
  const toastEl = $('#toast');
  let toastT;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  // ── smooth scroll (own easing so it also works for hand clicks)
  let scrollAnim = null;
  function scrollToY(y, dur = 900) {
    cancelAnimationFrame(scrollAnim);
    const start = scrollY, d = y - start, t0 = performance.now();
    if (reduce || Math.abs(d) < 2) { scrollTo(0, y); return; }
    const ease = t => 1 - Math.pow(1 - t, 4);
    const step = now => {
      const t = Math.min(1, (now - t0) / dur);
      scrollTo(0, start + d * ease(t));
      if (t < 1) scrollAnim = requestAnimationFrame(step);
    };
    scrollAnim = requestAnimationFrame(step);
  }
  function scrollToEl(el) { if (el) scrollToY(el.getBoundingClientRect().top + scrollY - 20); }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    const el = id === 'top' || id === '' ? document.body : document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    if (id === 'top') scrollToY(0); else scrollToEl(el);
  });
  $$('[data-top]').forEach(b => b.addEventListener('click', () => scrollToY(0, 1200)));

  // ── nav appears once you leave the hero
  const nav = $('#nav'), hud = $('#hud');
  const onScroll = () => {
    const past = scrollY > innerHeight * 0.6;
    nav.classList.toggle('show', past);
    document.documentElement.classList.toggle('past-hero', past);
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ── reveal on scroll
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  $$('.reveal').forEach(el => io.observe(el));

  // ── copy email
  $$('[data-copy]').forEach(b => b.addEventListener('click', async e => {
    e.preventDefault();
    const txt = b.dataset.copy;
    try { await navigator.clipboard.writeText(txt); toast('Email copied — ' + txt); }
    catch { toast(txt); }
  }));

  // ── drawers
  const scrim = $('#drawerScrim');
  let openId = null, lastFocus = null;
  function openDrawer(id, opts = {}) {
    const d = document.getElementById('drawer-' + id);
    if (!d) return;
    if (openId && openId !== id) closeDrawer(true);
    openId = id; lastFocus = document.activeElement;
    scrim.hidden = false;
    requestAnimationFrame(() => scrim.classList.add('show'));
    d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');
    if (id === 'contact' && opts.topic) setTopic(opts.topic, true);
    if (id === 'waitlist') loadTypeform(d);
    setTimeout(() => { const f = d.querySelector('.dr-close'); f && f.focus({ preventScroll: true }); }, 400);
  }
  function closeDrawer(silent) {
    if (!openId) return;
    const d = document.getElementById('drawer-' + openId);
    d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
    openId = null;
    if (!silent) {
      scrim.classList.remove('show');
      setTimeout(() => { if (!openId) scrim.hidden = true; }, 450);
      document.body.classList.remove('drawer-open');
      lastFocus && lastFocus.focus && lastFocus.focus({ preventScroll: true });
    }
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-drawer]');
    if (t) { e.preventDefault(); openDrawer(t.dataset.drawer, { topic: t.dataset.topic }); return; }
    if (e.target.closest('[data-close]') || e.target === scrim) closeDrawer();
  });
  addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  function loadTypeform(d) {
    const box = d.querySelector('.dr-frame');
    if (!box || box.querySelector('iframe')) return;
    const f = document.createElement('iframe');
    f.src = box.dataset.src;
    f.title = 'Webdesigner – předregistrace';
    f.allow = 'camera; microphone; autoplay; encrypted-media; fullscreen';
    f.addEventListener('load', () => { const l = box.querySelector('.dr-loading'); l && l.remove(); });
    box.appendChild(f);
  }

  // ── contact form: topics + mailto
  const form = $('#contactForm');
  const topics = new Set();
  function setTopic(name, only) {
    if (only) topics.clear();
    if (topics.has(name) && !only) topics.delete(name); else topics.add(name);
    $$('.topic', form).forEach(b => b.classList.toggle('on', topics.has(b.dataset.topic)));
  }
  $$('.topic', form).forEach(b => b.addEventListener('click', () => setTopic(b.dataset.topic)));
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = (fd.get('name') || '').toString().trim();
    const email = (fd.get('email') || '').toString().trim();
    const msg = (fd.get('message') || '').toString().trim();
    const what = [...topics].join(', ') || 'New project';
    const subject = `${what}${name ? ' — ' + name : ''}`;
    const body = [msg || '(describe the project here)', '', '—', name && `Name: ${name}`, email && `Email: ${email}`, topics.size && `Topic: ${what}`]
      .filter(Boolean).join('\n');
    location.href = `mailto:blazek@socialmind.cz?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    $('#formNote').textContent = 'Your mail app should open now. Or write to blazek@socialmind.cz';
  });

  // ── tabs (O programu / Obsah programu)
  $$('.tabs').forEach(tabs => {
    const root = tabs.parentElement;
    $$('.tab', tabs).forEach(t => t.addEventListener('click', () => {
      $$('.tab', tabs).forEach(x => { const on = x === t; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
      $$('.tab-panel', root).forEach(p => p.classList.toggle('on', p.dataset.panel === t.dataset.tab));
    }));
  });
  // ── module accordion
  // only one module open at a time
  $$('.mod-head').forEach(h => h.addEventListener('click', () => {
    const m = h.parentElement, open = !m.classList.contains('open');
    $$('.mod', m.parentElement).forEach(x => { x.classList.remove('open'); x.querySelector('.mod-head').setAttribute('aria-expanded', 'false'); });
    if (open) { m.classList.add('open'); h.setAttribute('aria-expanded', 'true'); }
  }));
  // ── course video plays only while visible
  const vid = $('#wdVideo');
  if (vid) new IntersectionObserver(([en]) => {
    if (en.isIntersecting) { vid.preload = 'auto'; vid.play().catch(() => {}); } else vid.pause();
  }, { threshold: 0.2 }).observe(vid);

  window.siteUI = {
    openDrawer, closeDrawer, toast, scrollToY,
    get drawerOpen() { return openId; },
    hud,
  };
})();
