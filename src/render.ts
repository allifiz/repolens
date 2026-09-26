import type { ScanResult } from './types.js';

function escapeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function renderHtml(result: ScanResult): string {
  const data = escapeJsonForHtml(result);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RepoLens · ${result.project}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #080b12; color: #e9eefb; }
    header { position: sticky; top: 0; z-index: 2; display:flex; justify-content:space-between; gap:24px; align-items:center; padding:18px 24px; background:rgba(8,11,18,.92); border-bottom:1px solid #20283a; backdrop-filter: blur(12px); }
    h1 { margin:0; font-size:20px; }
    .muted { color:#8994ab; }
    .stats { display:flex; gap:10px; flex-wrap:wrap; }
    .pill { background:#131927; border:1px solid #273149; padding:7px 10px; border-radius:999px; font-size:12px; }
    main { display:grid; grid-template-columns: 320px 1fr; min-height:calc(100vh - 73px); }
    aside { border-right:1px solid #20283a; padding:18px; overflow:auto; }
    section { padding:22px; overflow:auto; }
    input { width:100%; background:#101522; color:#fff; border:1px solid #2a3550; border-radius:10px; padding:11px 12px; outline:none; }
    .tabs { display:flex; gap:8px; margin:14px 0; }
    button { background:#121827; color:#aeb9cf; border:1px solid #2a3550; border-radius:9px; padding:8px 10px; cursor:pointer; }
    button.active { background:#27385f; color:#fff; }
    .list { display:flex; flex-direction:column; gap:8px; }
    .card { background:#0f1420; border:1px solid #202a40; border-radius:12px; padding:12px; cursor:pointer; }
    .card:hover { border-color:#536caa; }
    .tag { font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#8da6df; }
    .path { margin-top:5px; font-size:11px; color:#77839a; overflow-wrap:anywhere; }
    .endpoint { display:grid; grid-template-columns:76px 1fr; gap:10px; align-items:center; }
    .method { font-weight:800; font-size:11px; color:#b7d1ff; }
    .graph { position:relative; min-width:800px; min-height:640px; border:1px solid #20283a; border-radius:14px; background:radial-gradient(circle at center, #111827, #0a0e17 65%); overflow:hidden; }
    svg { position:absolute; inset:0; width:100%; height:100%; }
    .node { position:absolute; width:170px; transform:translate(-50%,-50%); padding:10px; border-radius:10px; background:#151d2d; border:1px solid #34415f; box-shadow:0 12px 35px rgba(0,0,0,.25); }
    .node.controller { border-color:#4d70b8; }
    .node.service { border-color:#446e64; }
    .node.module { border-color:#765e9f; }
    .node.file { opacity:.72; width:150px; }
    .node-title { font-size:12px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .node-meta { font-size:10px; color:#7f8ca4; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .empty { padding:30px; text-align:center; color:#6f7b91; }
    @media (max-width: 850px) { main { grid-template-columns:1fr; } aside { border-right:0; border-bottom:1px solid #20283a; } }
  </style>
</head>
<body>
<header>
  <div>
    <h1>RepoLens <span class="muted">/ ${result.project}</span></h1>
    <div class="muted" style="font-size:12px;margin-top:4px">Understand your codebase without opening seventeen tabs.</div>
  </div>
  <div class="stats">
    <span class="pill">${result.filesScanned} files</span>
    <span class="pill">${result.nodes.length} nodes</span>
    <span class="pill">${result.edges.length} relations</span>
    <span class="pill">${result.endpoints.length} endpoints</span>
  </div>
</header>
<main>
  <aside>
    <input id="search" placeholder="Search files, classes, endpoints..." />
    <div class="tabs">
      <button class="active" data-tab="symbols">Symbols</button>
      <button data-tab="endpoints">Endpoints</button>
    </div>
    <div id="sidebar" class="list"></div>
  </aside>
  <section>
    <div id="graph" class="graph"></div>
  </section>
</main>
<script>
const DATA = ${data};
const sidebar = document.getElementById('sidebar');
const search = document.getElementById('search');
const graph = document.getElementById('graph');
let tab = 'symbols';

function renderSidebar() {
  const q = search.value.toLowerCase().trim();

  if (tab === 'endpoints') {
    const items = DATA.endpoints.filter(function (e) {
      return [e.method, e.path, e.controller, e.handler, e.file]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });

    sidebar.innerHTML = items.length
      ? items.map(function (e) {
          return '<div class="card endpoint">' +
            '<span class="method">' + e.method + '</span>' +
            '<div><div>' + e.path + '</div>' +
            '<div class="path">' + e.controller + '.' + e.handler +
            ' · ' + e.file + ':' + e.line + '</div></div></div>';
        }).join('')
      : '<div class="empty">No endpoints found.</div>';

    return;
  }

  const items = DATA.nodes.filter(function (n) {
    return n.kind !== 'file' &&
      [n.label, n.kind, n.file].join(' ').toLowerCase().includes(q);
  });

  sidebar.innerHTML = items.length
    ? items.map(function (n) {
        return '<div class="card" data-node="' + encodeURIComponent(n.id) + '">' +
          '<div class="tag">' + n.kind + '</div>' +
          '<div>' + n.label + '</div>' +
          '<div class="path">' + n.file + (n.line ? ':' + n.line : '') + '</div>' +
          '</div>';
      }).join('')
    : '<div class="empty">No symbols found.</div>';
}

function renderGraph(focusId) {
  graph.innerHTML = '<svg id="edges"></svg>';

  const nodes = focusId
    ? DATA.nodes.filter(function (n) {
        return n.id === focusId || DATA.edges.some(function (e) {
          return (e.source === focusId && e.target === n.id) ||
            (e.target === focusId && e.source === n.id);
        });
      })
    : DATA.nodes.filter(function (n) { return n.kind !== 'file'; }).slice(0, 32);

  if (!nodes.length) {
    graph.innerHTML = '<div class="empty">No graphable symbols found yet.</div>';
    return;
  }

  const ids = new Set(nodes.map(function (n) { return n.id; }));
  const cols = Math.max(2, Math.ceil(Math.sqrt(nodes.length)));
  const width = Math.max(graph.clientWidth, 800);
  const height = Math.max(graph.clientHeight, 640);
  const positions = new Map();

  nodes.forEach(function (n, i) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = ((col + 1) / (cols + 1)) * width;
    const rows = Math.ceil(nodes.length / cols);
    const y = ((row + 1) / (rows + 1)) * height;
    positions.set(n.id, { x: x, y: y });

    const div = document.createElement('div');
    div.className = 'node ' + n.kind;
    div.style.left = x + 'px';
    div.style.top = y + 'px';
    div.innerHTML =
      '<div class="tag">' + n.kind + '</div>' +
      '<div class="node-title">' + n.label + '</div>' +
      '<div class="node-meta">' + n.file + '</div>';
    div.onclick = function () { renderGraph(n.id); };
    graph.appendChild(div);
  });

  const svg = document.getElementById('edges');

  DATA.edges
    .filter(function (e) { return ids.has(e.source) && ids.has(e.target); })
    .forEach(function (e) {
      const a = positions.get(e.source);
      const b = positions.get(e.target);
      if (!a || !b || !svg) return;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(a.x));
      line.setAttribute('y1', String(a.y));
      line.setAttribute('x2', String(b.x));
      line.setAttribute('y2', String(b.y));
      line.setAttribute('stroke', e.type === 'injects' ? '#6c87c6' : '#35415c');
      line.setAttribute('stroke-width', e.type === 'injects' ? '2' : '1');
      line.setAttribute('opacity', '0.75');
      svg.appendChild(line);
    });
}

document.querySelectorAll('[data-tab]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.classList.remove('active');
    });

    btn.classList.add('active');
    tab = btn.dataset.tab;
    renderSidebar();
  });
});

search.addEventListener('input', renderSidebar);

sidebar.addEventListener('click', function (event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const card = target.closest('[data-node]');
  if (card && card instanceof HTMLElement && card.dataset.node) {
    renderGraph(decodeURIComponent(card.dataset.node));
  }
});

renderSidebar();
renderGraph();
</script>
</body>
</html>`;
}
