/* Návod page: interactive squeeze demo (slider = hand), copy buttons, TOC highlight */
(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  // ── toast + copy
  const toastEl = $('#toast'); let tt;
  const toast = m => { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 1800); };
  $$('.copy').forEach(b => b.addEventListener('click', async () => {
    const box = b.closest('.prompt, .code');
    const txt = box.querySelector('pre').innerText.trim();
    try { await navigator.clipboard.writeText(txt); b.textContent = 'Zkopírováno ✓'; toast('Zkopírováno do schránky'); }
    catch { b.textContent = 'Označ a zkopíruj'; }
    setTimeout(() => (b.textContent = 'Kopírovat'), 1800);
  }));

  // ── TOC highlight
  const links = $$('.toc a');
  const map = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { links.forEach(l => l.classList.remove('on')); const a = map.get(e.target.id); a && a.classList.add('on'); }
  }), { rootMargin: '-30% 0px -60% 0px' });
  $$('.step[id]').forEach(s => io.observe(s));

  // ── demo
  const N = 121, frames = new Array(N);
  const cv = $('#demoHead'), ctx = cv.getContext('2d');
  const range = $('#demoRange'), svg = $('#demoHand'), ouch = $('#demoOuch');
  let cur = 0, target = 0, shown = -1, loaded = 0, popped = false;

  for (let i = 0; i < N; i++) {
    const im = new Image();
    im.onload = () => { frames[i] = im; loaded++; if (i === 0) draw(true); };
    im.src = `frames/h${String(i).padStart(3, '0')}.webp`;
  }

  // synthetic hand (front view): curl 0 = open palm, 1 = fist
  const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  function hand(curl) {
    const W = { x: 110, y: 196 };
    const pts = [W];
    // thumb: swings across the palm when closing
    const th = [[78, 168], [62, 146], [52, 126], [46, 108]];
    const thC = [[86, 170], [92, 158], [104, 152], [114, 150]];
    th.forEach((p, j) => pts.push({ x: lerp(p[0], thC[j][0], curl), y: lerp(p[1], thC[j][1], curl) }));
    const bases = [[84, 122], [106, 116], [127, 120], [146, 130]];
    const lens = [62, 70, 64, 50];
    const k = [0.55, 1.15, 1.7];
    bases.forEach(([bx, by], f) => {
      pts.push({ x: bx, y: by });
      let acc = 0;
      [0.42, 0.31, 0.27].forEach((part, j) => {
        acc += lens[f] * part;
        pts.push({ x: bx + (bx - 115) * 0.08 * (j + 1) * (1 - curl), y: by - acc * (1 - curl * k[j]) });
      });
    });
    return pts;
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function drawHand(pts) {
    const lines = BONES.map(([a, b]) => `<line x1="${pts[a].x.toFixed(1)}" y1="${pts[a].y.toFixed(1)}" x2="${pts[b].x.toFixed(1)}" y2="${pts[b].y.toFixed(1)}"/>`).join('');
    const dots = pts.map((p, i) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${[8, 12, 16, 20].includes(i) ? 4.5 : 3}" class="${[8, 12, 16, 20].includes(i) ? 'tip' : ''}"/>`).join('');
    svg.innerHTML = `<g class="bones">${lines}</g><g class="dots">${dots}</g>`;
  }

  function compute(v) {
    const pts = hand(v);
    const palm = dist(pts[0], pts[9]);
    const ratio = [8, 12, 16, 20].reduce((s, i) => s + dist(pts[i], pts[0]), 0) / 4 / palm;
    const open = clamp01((ratio - 1.05) / (1.80 - 1.05));
    const sq = smooth(0.40, 0.93, 1 - open);
    return { pts, ratio, sq };
  }

  function draw(force) {
    const idx = Math.round(cur * (N - 1));
    let i = idx; while (i > 0 && !frames[i]) i--;
    if (!frames[i] || (i === shown && !force)) return;
    shown = i;
    const w = smooth(0.15, 0.9, i / (N - 1));
    const scale = (cv.height * 0.86 / 1372) * lerp(1, 0.765, w);
    const dw = 1302 * scale, dh = 1372 * scale;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(frames[i], (cv.width - dw) / 2, (cv.height - dh) / 2 + lerp(0, 20, w), dw, dh);
    $('#vFrame').textContent = `${i} / 120`;
  }

  function update() {
    const { pts, ratio, sq } = compute(range.value / 1000);
    drawHand(pts);
    target = sq;
    $('#vRatio').textContent = ratio.toFixed(2);
    $('#vSq').textContent = sq.toFixed(2);
  }
  range.addEventListener('input', update);
  update();

  let last = performance.now();
  (function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    cur += (target - cur) * (1 - Math.exp(-9 * dt));
    draw();
    if (!popped && cur > 0.86) { popped = true; ouch.classList.remove('on'); void ouch.offsetWidth; ouch.classList.add('on'); }
    else if (popped && cur < 0.55) { popped = false; ouch.classList.remove('on'); }
    requestAnimationFrame(tick);
  })(last);

  // gentle hint animation until the user touches the slider
  let touched = false, t0 = performance.now();
  range.addEventListener('pointerdown', () => (touched = true), { once: true });
  range.addEventListener('keydown', () => (touched = true), { once: true });
  const demoBox = $('.demo');
  let visible = false;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.4 }).observe(demoBox);
  (function hint(now) {
    if (touched) return;
    if (visible) {
      const t = ((now - t0) / 1000) % 6;
      const v = t < 2.5 ? smooth(0, 2.5, t) : t < 3.5 ? 1 : 1 - smooth(3.5, 5.5, t);
      range.value = Math.round(v * 1000); update();
    }
    requestAnimationFrame(hint);
  })(t0);
})();
