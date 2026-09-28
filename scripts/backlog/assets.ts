// Inline stylesheet and scripts for backlog.html (mw-e00.11). The page is one self-contained file that makes
// no external requests, so the display and body faces are local font stacks of the same character as the
// landing page's IM Fell English (old-style serif) and Atkinson Hyperlegible (humanist sans).

const SERIF = `"IM Fell English", "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif`;
const SANS = `"Atkinson Hyperlegible", Seravek, "Gill Sans Nova", "Segoe UI", Candara, "Noto Sans", Ubuntu, system-ui, sans-serif`;

const LIGHT = `--stone: #e4e7e1; --slab: #f2f4ef; --ink: #1f2a25; --muted: #5d6a63; --rule: #c3cac2;
  --moss: #2f6f5e; --moss-soft: #d3e5dc; --arcane: #5b3f95; --arcane-soft: #e3dcf2;
  --blood: #9c2f2f; --blood-soft: #f2d9d6; --gold: #8a6a1f; --gold-soft: #efe4c8; --focus: #5b3f95;`;
const DARK = `--stone: #151c19; --slab: #1d2622; --ink: #dbe2dc; --muted: #93a39a; --rule: #34423b;
  --moss: #7cc3ad; --moss-soft: #203a32; --arcane: #b8a2ea; --arcane-soft: #2e2645;
  --blood: #e48b82; --blood-soft: #3d2322; --gold: #d8b563; --gold-soft: #3a3120; --focus: #b8a2ea;`;

export const STYLES = `
:root { ${LIGHT} color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${DARK} color-scheme: dark; } }
:root[data-theme="dark"] { ${DARK} color-scheme: dark; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--stone); color: var(--ink); font: 16px/1.55 ${SANS}; overflow-wrap: anywhere; }
a { color: var(--arcane); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 3px; }
[hidden] { display: none !important; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 0 16px 64px; }
header { padding: 40px 0 20px; }
h1 { font: 400 clamp(2.2rem, 6vw, 3.6rem)/1.05 ${SERIF}; margin: 0 0 8px; letter-spacing: -0.01em; }
.sub { color: var(--muted); margin: 0; max-width: 62ch; }
.stamp { color: var(--muted); font-size: .85rem; margin: 8px 0 0; }
.tally { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 18px 0 0; padding: 0; list-style: none; color: var(--muted); font-size: .95rem; }
.tally b { color: var(--ink); font-size: 1.15rem; }
.tabs { display: flex; gap: 4px; border-bottom: 2px solid var(--rule); margin-top: 24px; }
.tab { appearance: none; border: 0; background: none; color: var(--muted); font: inherit; font-weight: 700;
  padding: 10px 14px; cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -2px; }
.tab[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--moss); }
.tab .n { font-weight: 400; color: var(--muted); margin-left: 1px; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 0; align-items: center; }
.filters input, .filters select { font: inherit; font-size: .92rem; color: var(--ink); background: var(--slab);
  border: 1px solid var(--rule); border-radius: 6px; padding: 7px 10px; }
.filters input { flex: 1 1 220px; min-width: 0; }
.filters label { font-size: .9rem; color: var(--muted); display: flex; gap: 6px; align-items: center; }
.theme { margin-left: auto; }
.epic { margin: 18px 0; }
.epic > summary { list-style: none; cursor: pointer; display: grid; grid-template-columns: 3.6rem 1fr auto; gap: 12px; align-items: baseline; padding: 10px 0; border-bottom: 1px solid var(--rule); }
.epic > summary::-webkit-details-marker { display: none; }
.eno { font: 700 1.1rem/1 ${SANS}; color: var(--moss); font-variant-numeric: tabular-nums; }
.etitle { font: 400 1.35rem/1.2 ${SERIF}; }
.eoutcome { display: block; font: .9rem/1.45 ${SANS}; color: var(--muted); margin-top: 3px; }
.eprog { font-size: .85rem; color: var(--muted); white-space: nowrap; text-align: right; }
.bar { display: block; width: 110px; height: 5px; background: var(--rule); border-radius: 3px; margin-top: 5px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--moss); }
.msh { font: 700 .78rem/1 ${SANS}; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 14px 0 0 3.6rem; }
.msh .n { font-weight: 400; margin-left: 2px; }
.rows { list-style: none; margin: 0; padding: 0; }
.row { border-bottom: 1px solid var(--rule); }
.row > details > summary { list-style: none; cursor: pointer; display: grid; grid-template-columns: 6.2rem 1fr auto; gap: 10px; padding: 9px 0 9px 3.6rem; align-items: baseline; }
.row > details > summary::-webkit-details-marker { display: none; }
.row > details[open] > summary, .row:target > details > summary { background: var(--slab); }
.rid { font-size: .82rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.rtitle { min-width: 0; }
.meta { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.pill { font-size: .75rem; padding: 1px 7px; border-radius: 999px; white-space: nowrap; background: var(--slab); color: var(--muted); border: 1px solid var(--rule); }
.p0 { background: var(--blood-soft); color: var(--blood); border-color: transparent; }
.p1 { background: var(--gold-soft); color: var(--gold); border-color: transparent; }
.st-in_progress { background: var(--arcane-soft); color: var(--arcane); border-color: transparent; }
.st-closed { background: var(--moss-soft); color: var(--moss); border-color: transparent; }
.st-blocked, .st-unknown { background: transparent; color: var(--blood); border-style: dashed; }
.body { padding: 4px 0 18px 3.6rem; background: var(--slab); }
.body .cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 28px; padding-right: 12px; }
.body h4 { font: 400 1.1rem ${SERIF}; margin: 10px 0 4px; color: var(--moss); }
.md { font-size: .93rem; max-width: 70ch; }
.md h3, .md h4, .md h5, .md h6 { font: 700 .9rem ${SANS}; margin: 12px 0 2px; color: var(--ink); }
.md p { margin: 4px 0; }
.md ul, .md ol { margin: 4px 0; padding-left: 1.3rem; }
.md li { margin: 3px 0; }
.md code { font-size: .88em; background: var(--stone); padding: 0 4px; border-radius: 3px; }
.md pre { background: var(--stone); padding: 8px 10px; border-radius: 4px; overflow-x: auto; }
.md pre code { padding: 0; }
.tag { font-size: .72rem; font-weight: 700; color: var(--arcane); }
.labels { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 10px; }
.deps { list-style: none; margin: 0; padding: 0; font-size: .88rem; }
.deps li { margin: 3px 0; }
.empty { color: var(--muted); padding: 40px 0; }
footer { color: var(--muted); font-size: .85rem; margin-top: 40px; }
.pill a { color: inherit; }
.banner { margin: 12px 0 0; padding: 8px 12px; border-radius: 6px; background: var(--gold-soft); color: var(--ink); font-size: .9rem; }
.unknown h2 { font: 400 1.1rem ${SERIF}; color: var(--ink); margin: 0 0 4px; }
.unknown ul { margin: 4px 0 16px; padding-left: 1.2rem; }
@media (max-width: 720px) {
  .epic > summary { grid-template-columns: 2.8rem 1fr; }
  .eprog { grid-column: 2; text-align: left; }
  .msh { margin-left: 0; }
  .row > details > summary { grid-template-columns: 1fr; padding-left: 0; gap: 3px; }
  .meta { justify-content: flex-start; }
  .body { padding-left: 10px; }
  .body .cols { grid-template-columns: 1fr; gap: 0; }
}
@media (prefers-reduced-motion: no-preference) { .bar i { transition: width .4s ease; } }
`;

/** Runs in <head> so a saved theme applies before first paint. */
export const THEME_BOOT = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

/** Tabs (click and arrow keys), filters, theme toggle and in-page dependency links. */
export const CLIENT = `(function () {
  'use strict';
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  var panels = tabs.map(function (t) { return document.getElementById(t.getAttribute('aria-controls')); });
  function select(tab, focus) {
    tabs.forEach(function (t, i) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    });
    if (focus) tab.focus();
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { select(tab, false); });
    tab.addEventListener('keydown', function (e) {
      var next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      select(tabs[(next + tabs.length) % tabs.length], true);
    });
  });

  var q = document.getElementById('q');
  var fields = [['ms', document.getElementById('f-ms')], ['class', document.getElementById('f-class')], ['p', document.getElementById('f-p')]];
  var rows = Array.prototype.slice.call(document.querySelectorAll('.row'));
  var text = new Map();
  function applyFilters() {
    var needle = q.value.trim().toLowerCase();
    rows.forEach(function (row) {
      var ok = fields.every(function (f) { return !f[1].value || row.dataset[f[0]] === f[1].value; });
      if (ok && needle) {
        if (!text.has(row)) text.set(row, row.textContent.toLowerCase());
        ok = text.get(row).indexOf(needle) !== -1;
      }
      row.hidden = !ok;
    });
    document.querySelectorAll('.ms, .epic').forEach(function (g) { g.hidden = !g.querySelector('.row:not([hidden])'); });
    panels.forEach(function (panel, i) {
      var shown = panel.querySelectorAll('.row:not([hidden])').length;
      var total = panel.querySelectorAll('.row').length;
      var none = panel.querySelector('.filter-empty');
      if (none) none.hidden = shown > 0 || total === 0;
      tabs[i].querySelector('.n').textContent = shown === total ? String(total) : shown + ' of ' + total;
    });
  }
  q.addEventListener('input', applyFilters);
  fields.forEach(function (f) { f[1].addEventListener('input', applyFilters); });

  function reveal(id) {
    var row = document.getElementById(id);
    if (!row || !row.classList.contains('row')) return;
    if (row.hidden) {
      q.value = '';
      fields.forEach(function (f) { f[1].value = ''; });
      applyFilters();
    }
    var panel = row.closest('[role="tabpanel"]');
    select(tabs[panels.indexOf(panel)], false);
    row.closest('.epic').open = true;
    row.querySelector('details').open = true;
    row.scrollIntoView({ block: 'start' });
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = decodeURIComponent(a.getAttribute('href').slice(1));
    if (!document.getElementById(id)) return;
    e.preventDefault();
    try { history.pushState(null, '', '#' + encodeURIComponent(id)); } catch (err) {}
    reveal(id);
  });
  window.addEventListener('hashchange', function () { reveal(decodeURIComponent(location.hash.slice(1))); });

  document.getElementById('theme').addEventListener('click', function () {
    var root = document.documentElement;
    var dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
  });

  if (location.hash) reveal(decodeURIComponent(location.hash.slice(1)));
})();`;
