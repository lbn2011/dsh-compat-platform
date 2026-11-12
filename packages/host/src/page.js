/**
 * page — the one HTML document this plugin serves.
 *
 * WHAT THIS MODULE IS: a pure function returning a self-contained page. Inline
 * CSS and inline script, no build artefact, no external host, no bundler. The
 * page fetches the envelope from its own origin and renders it with
 * `textContent` everywhere, so nothing inside an evidence document can become
 * markup.
 *
 * WHY IT IS PLAIN LISTS, NOT A DASHBOARD: a diagnostic envelope is a set of
 * named sources with states, outcomes and codes. Rendering it as anything
 * richer (charts, scores, green ticks) would invent an interpretation the
 * envelope does not contain, and a green badge on this page is exactly the
 * reading the records forbid. Colour is therefore used only to separate a
 * refusal from an absence, never to say "fine".
 *
 * WHY THE NON-CLAIMS ARE IN THE MARKUP, NOT IN A COMMENT: a screenshot of this
 * page is the most likely artefact to be quoted later. The literals
 * `certification: false` and `correlation: not-established` therefore sit in the
 * header and in a fixed footer, present before any data loads, so no screenshot
 * can show this page looking like a clean bill of health.
 *
 * LANGUAGE: the prose is Chinese because the reader of this route is the
 * operator of this installation. Every machine word (state, outcome, baseline
 * state, limitation code, issue code) is printed verbatim next to its Chinese
 * gloss, so a translated label can never be mistaken for the value itself.
 *
 * DESIGN: unified design tokens — 5-layer surface tonal ladder tinted toward
 * cyan, fluid clamp() typography, grid-first layout, fully-rounded geometry
 * (999px pills, 50% circles). Dark-first; light mode via prefers-color-scheme.
 * Colour is used only to separate a refusal from an absence, never to claim
 * "fine" or invent a certification result this envelope does not contain.
 */

/** Content type of the page response. */
export const PAGE_CONTENT_TYPE = 'text/html; charset=utf-8'

/**
 * Render the read-only diagnostics page.
 *
 * @returns {string} The complete HTML document.
 */
export function renderPage(envelopeRoutePath = '/compat-diagnostics/envelope') {
  // Encode for an inline script, not HTML: a configured path must never close
  // the script element or introduce JavaScript source.
  const envelopeUrlLiteral = JSON.stringify(envelopeRoutePath)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self' ws:; img-src 'none'; form-action 'none'; base-uri 'none'">
<title>兼容性诊断 · 只读</title>
<style>
/* ── design tokens ─────────────────────────────────────────── */
:root {
  color-scheme: light dark;
  /* 5-layer surface tonal ladder (dark-first, cyan-tinted) */
  --surface-0: #05070C;
  --surface-1: #0A0D12;
  --surface-2: #0F131C;
  --surface-3: #161D2B;
  --surface-4: #1E2636;
  /* ink */
  --ink: #e8e8f0;
  --ink-soft: #a8a8bb;
  --ink-faint: #767688;
  --line: #2b2b36;
  /* luminous accent — high-saturation cyan */
  --accent: #38BDF8;
  --accent-dim: #1e7a9f;
  --accent-glow: rgba(56,189,248,0.12);
  /* semantic states */
  --warn: #e0b850;
  --warn-bg: #302916;
  --bad: #ff8b8b;
  --bad-bg: #331c1c;
  --good: #6EE7B7;
  --good-bg: #1a3328;
  /* shadows */
  --shadow-sm: 0 1px 3px rgba(0,0,0,.35);
  --shadow-md: 0 2px 8px rgba(0,0,0,.45), 0 1px 2px rgba(0,0,0,.3);
  /* spacing */
  --sp-xs:.25rem; --sp-sm:.5rem; --sp-md:1rem; --sp-lg:1.5rem; --sp-xl:2rem;
  /* radius */
  --r-sm:4px; --r-md:8px; --r-lg:12px; --r-full:999px;
  /* type scale (fluid) */
  --tx-xs: clamp(.72rem,.7rem + .1vw,.78rem);
  --tx-sm: clamp(.82rem,.8rem + .1vw,.9rem);
  --tx-base: clamp(.95rem,.93rem + .1vw,1rem);
  --tx-lg: clamp(1.1rem,1.05rem + .25vw,1.25rem);
  --tx-xl: clamp(1.35rem,1.25rem + .5vw,1.75rem);
}
@media (prefers-color-scheme: light) {
  :root {
    --surface-0:#fafbfc; --surface-1:#f6f7fb;
    --surface-2:#ffffff; --surface-3:#f1f2f6; --surface-4:#e8e9ef;
    --ink:#1b1b20; --ink-soft:#5a5a68; --ink-faint:#8a8a99; --line:#e2e3ec;
    --accent:#2d93cc; --accent-dim:#5ab3e8; --accent-glow:rgba(45,147,204,.1);
    --warn:#b08419; --warn-bg:#fdf6e3;
    --bad:#b02a2a; --bad-bg:#fdeeee;
    --good:#28a876; --good-bg:#e8f8f2;
    --shadow-sm:0 1px 2px rgba(20,20,40,.05);
    --shadow-md:0 2px 8px rgba(20,20,40,.08),0 1px 2px rgba(20,20,40,.04);
  }
}
/* ── base ──────────────────────────────────────────────────── */
*{box-sizing:border-box;}
body {
  margin:0; padding:var(--sp-xl) var(--sp-lg) 7rem;
  background:var(--surface-1); color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans CJK SC",
    "PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  font-size:var(--tx-base); line-height:1.65;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:66rem;margin:0 auto;}
/* ── typography ────────────────────────────────────────────── */
h1{font-size:var(--tx-xl);font-weight:700;letter-spacing:-.02em;margin:0;line-height:1.3;}
h2{font-size:var(--tx-xs);font-weight:600;letter-spacing:.12em;text-transform:uppercase;
   color:var(--ink-faint);margin:var(--sp-xl) 0 var(--sp-sm);}
h3{font-size:var(--tx-base);font-weight:600;margin:0 0 var(--sp-sm);}
p{margin:var(--sp-xs) 0;}
.muted{color:var(--ink-soft);font-size:var(--tx-sm);}
code,pre,.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:.86em;}
code{background:var(--surface-3);border-radius:var(--r-sm);padding:.05em .35em;}
/* ── header ────────────────────────────────────────────────── */
header.top{
  padding-bottom:var(--sp-lg);
  border-bottom:1px solid var(--line);
}
.page-eyebrow{
  display:inline-flex;align-items:center;gap:var(--sp-sm);
  margin-bottom:var(--sp-sm);
  font-size:var(--tx-xs);font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  color:var(--accent);
}
.page-eyebrow::before{
  content:"";display:block;width:1.5rem;height:2px;
  background:var(--accent);border-radius:var(--r-full);
}
.claim{
  margin:var(--sp-lg) 0 0;padding:var(--sp-md) var(--sp-lg);
  border-left:3px solid var(--warn);border-radius:var(--r-md);
  background:var(--warn-bg);color:var(--ink);
}
.claim strong{display:block;margin-bottom:var(--sp-xs);}
.claim .literals{color:var(--ink-soft);font-size:var(--tx-sm);}
/* ── panels & cards ────────────────────────────────────────── */
.panel{
  background:var(--surface-2);border:1px solid var(--line);
  border-radius:var(--r-lg);padding:var(--sp-lg) var(--sp-md);
  box-shadow:var(--shadow-md);
}
dl.rows{display:grid;grid-template-columns:max-content 1fr;gap:.35rem var(--sp-lg);margin:0;}
dl.rows dt{color:var(--ink-soft);font-size:var(--tx-sm);}
dl.rows dd{margin:0;overflow-wrap:anywhere;}
.grid{display:grid;gap:var(--sp-md);grid-template-columns:repeat(auto-fit,minmax(20rem,1fr));}
.card{
  background:var(--surface-2);border:1px solid var(--line);
  border-radius:var(--r-lg);padding:var(--sp-lg) var(--sp-md);
  box-shadow:var(--shadow-md);
  transition:box-shadow .15s,border-color .15s;
}
.card:hover{box-shadow:var(--shadow-md),0 0 0 1px var(--accent-dim);border-color:var(--accent-dim);}
.card.refused{border-color:var(--bad);background:var(--bad-bg);}
.card.refused:hover{border-color:var(--bad);}
/* ── badges ────────────────────────────────────────────────── */
.badge{
  display:inline-block;margin-left:var(--sp-sm);padding:0 var(--sp-sm);
  border:1px solid var(--line);border-radius:var(--r-full);
  font-size:var(--tx-xs);color:var(--ink-soft);vertical-align:1px;
}
.badge.warn{border-color:var(--warn);color:var(--warn);background:var(--warn-bg);}
.badge.bad{border-color:var(--bad);color:var(--bad);background:var(--bad-bg);}
.badge.good{border-color:var(--good);color:var(--good);background:var(--good-bg);}
/* ── code lists & plain lists ──────────────────────────────── */
ul.codes{list-style:none;padding:0;margin:var(--sp-xs) 0 0;display:flex;flex-wrap:wrap;gap:var(--sp-xs);}
ul.codes>li{
  border:1px solid var(--line);border-radius:var(--r-sm);
  padding:.05rem var(--sp-sm);
  font-family:ui-monospace,Menlo,Consolas,monospace;font-size:var(--tx-xs);
  color:var(--ink-soft);
}
ul.plain{margin:0;padding-left:var(--sp-lg);}
ul.plain>li{margin:var(--sp-xs) 0;}
/* ── details / summary ─────────────────────────────────────── */
details{margin-top:var(--sp-md);}
summary{cursor:pointer;color:var(--ink-faint);font-size:var(--tx-sm);user-select:none;}
summary:hover{color:var(--accent);}
pre{
  margin:var(--sp-sm) 0 0;padding:var(--sp-md);overflow:auto;max-height:24rem;
  background:var(--surface-0);border:1px solid var(--line);border-radius:var(--r-md);
  font-size:var(--tx-xs);line-height:1.55;
}
/* ── buttons ───────────────────────────────────────────── */
button{
  padding:var(--sp-sm) var(--sp-lg);border:1px solid var(--line);
  border-radius:var(--r-full);background:var(--surface-3);
  color:var(--ink);font:inherit;font-size:var(--tx-sm);
  cursor:pointer;transition:background .15s,border-color .15s;
}
button:hover{background:var(--surface-4);border-color:var(--accent-dim);}
button:active{background:var(--surface-2);}
button:disabled{opacity:.5;cursor:not-allowed;}
button.primary{background:var(--accent);border-color:var(--accent);color:#000;font-weight:600;}
button.primary:hover{background:var(--accent-dim);border-color:var(--accent-dim);}
.btn-group{display:flex;gap:var(--sp-sm);flex-wrap:wrap;margin-top:var(--sp-md);}
/* ── live tools ────────────────────────────────────────── */
.ws-status{
  display:inline-flex;align-items:center;gap:var(--sp-xs);
  padding:var(--sp-xs) var(--sp-md);border-radius:var(--r-full);
  font-size:var(--tx-xs);font-weight:600;
  background:var(--surface-3);border:1px solid var(--line);
}
.ws-status::before{
  content:"";display:block;width:.5rem;height:.5rem;
  border-radius:50%;background:var(--ink-faint);
}
.ws-status.connected::before{background:var(--good);box-shadow:0 0 8px var(--good);}
.ws-status.connecting::before{background:var(--warn);animation:pulse 1.5s infinite;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.3;}}
.log-list{
  margin:var(--sp-md) 0 0;padding:var(--sp-md);
  background:var(--surface-0);border:1px solid var(--line);
  border-radius:var(--r-md);max-height:24rem;overflow-y:auto;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  font-size:var(--tx-xs);line-height:1.55;
}
.log-list:empty::before{content:"无日志";color:var(--ink-faint);}
.log-entry{margin:var(--sp-xs) 0;padding:var(--sp-xs);border-radius:var(--r-sm);}
.log-entry .time{color:var(--ink-faint);margin-right:var(--sp-sm);}
.log-entry .level{
  display:inline-block;min-width:3.5rem;margin-right:var(--sp-sm);
  font-weight:600;text-align:center;
}
.log-entry .level.error{color:var(--bad);}
.log-entry .level.warn{color:var(--warn);}
.log-entry .level.info{color:var(--accent);}
.log-entry .msg{color:var(--ink);}
/* ── fixed footer ──────────────────────────────────────────── */
footer{
  position:fixed;inset:auto 0 0 0;padding:var(--sp-sm) var(--sp-lg);
  background:var(--surface-2);border-top:1px solid var(--line);
  color:var(--ink-soft);font-size:var(--tx-xs);z-index:100;
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
}
footer .wrap{max-width:66rem;margin:0 auto;}
/* Narrow embedded panels must not inherit a 20rem minimum track width. */
.grid > *{min-width:0;}
summary:focus-visible{outline:2px solid var(--accent);outline-offset:4px;}
@media(max-width:40rem){
  .grid{grid-template-columns:minmax(0,1fr);}
  dl.rows{grid-template-columns:minmax(0,1fr);}
  dl.rows dd{margin-bottom:var(--sp-sm);}
  footer{position:static;}
}
@media(prefers-reduced-motion:reduce){
  .card{transition:none;}
}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="page-eyebrow">dsh-compat-platform</div>
    <h1>兼容性诊断 · 只读</h1>
    <p class="muted">
      本页只显示一份已经存在的 <code>dsh-compat-diagnose</code> 信封文件，
      不会重新运行任何分析，也不会加载任何插件。
    </p>
    <div class="claim">
      <strong>本页不对兼容性作出任何结论。</strong>
      <span class="literals"><code>certification: false</code> · <code>correlation: not-established</code></span>
    </div>
  </header>

  <section>
    <h2>信封信息</h2>
    <div class="panel">
      <dl class="rows" id="identity"><dt>加载中</dt><dd>…</dd></dl>
    </div>
  </section>

  <section>
    <h2>各来源通道</h2>
    <div class="grid" id="sources"><p class="muted">加载中…</p></div>
  </section>

  <section>
    <h2>各来源的基线</h2>
    <p class="muted">
      这里说明信封能读到每个来源各自基线的什么。<code>not-reflected</code>
      表示该通道的摘要里没有基线字段；这绝不表示那份文档没有基线。
    </p>
    <div class="grid" id="provenance"><p class="muted">加载中…</p></div>
  </section>

  <section>
    <h2>限制（完整清单）</h2>
    <div class="panel"><ul class="plain" id="limitations"><li class="muted">加载中…</li></ul></div>
  </section>

  <section>
    <h2>后续步骤</h2>
    <div class="panel"><ul class="plain" id="nextSteps"><li class="muted">加载中…</li></ul></div>
  </section>

  <section>
    <h2>实时诊断工具</h2>
    <p class="muted">
      这些工具直接读取主机当前状态，不依赖信封文件。快照采集和前端日志适用于活跃会话的实时诊断。
    </p>
    <div class="panel">
      <h3>页面快照</h3>
      <p class="muted">采集当前页面状态的结构化快照（会话、插件、服务、Slot 等）。</p>
      <div class="btn-group">
        <button id="btnSnapshot" class="primary">采集快照</button>
      </div>
      <details id="snapshotResult" style="margin-top:var(--sp-md);">
        <summary>快照结果</summary>
        <pre id="snapshotOutput"></pre>
      </details>
    </div>

    <div class="panel" style="margin-top:var(--sp-lg);">
      <h3>前端日志流 <span class="ws-status" id="wsStatus">未连接</span></h3>
      <p class="muted">实时接收浏览器前端通过 WebSocket 上报的日志。日志环形缓冲最多保留 100 条。</p>
      <div class="btn-group">
        <button id="btnLogConnect">连接日志流</button>
        <button id="btnLogDisconnect" disabled>断开</button>
        <button id="btnLogClear">清空显示</button>
      </div>
      <div class="log-list" id="logList"></div>
    </div>
  </section>
</div>

<footer>
  <div class="wrap">
    只读视图：只呈现一份信封文件。未加载任何插件，未运行任何宿主，本页不做分析；
    本页任何内容都不得被引用为兼容性、可加载性或认证结论。
    <code>certification: false</code> · <code>correlation: not-established</code>
  </div>
</footer>

<script>
(function () {
  'use strict';

  var ENVELOPE_URL = ${envelopeUrlLiteral};

  // Chinese glosses. The machine word is always printed beside the gloss, so a
  // translation can never be mistaken for the value in the document.
  var STATE_WORDS = { provided: '已提供', absent: '未提供' };
  var OUTCOME_WORDS = {
    unknown: '未知',
    clear: '无异常',
    attention: '需注意',
    invalid: '无效',
    error: '出错'
  };
  var BASELINE_WORDS = {
    recorded: '已记录',
    'not-reflected': '未反映',
    'not-provided': '未提供',
    'not-readable': '不可读'
  };
  // Only these get colour, and none of them means success.
  var OUTCOME_TONE = { attention: 'warn', invalid: 'bad', error: 'bad' };

  // Next-step codes are a closed set: one per source and outcome, plus the
  // absent case. The sentence beside each code is the envelope's own English
  // text and is printed verbatim — only the code is glossed.
  var NEXT_STEP_WORDS = {
    SOURCE_NOT_PROVIDED: '未提供该来源的文档',
    PROFILE_ATTENTION: 'profile 输入需注意',
    PROFILE_INVALID: 'profile 输入无效',
    PROFILE_ERROR: 'profile 输入出错',
    PROFILE_UNKNOWN: 'profile 输入结果未知',
    STATIC_ATTENTION: 'static 输入需注意',
    STATIC_INVALID: 'static 输入无效',
    STATIC_ERROR: 'static 输入出错',
    STATIC_UNKNOWN: 'static 输入结果未知',
    RUNTIME_ATTENTION: 'runtime 输入需注意',
    RUNTIME_INVALID: 'runtime 输入无效',
    RUNTIME_ERROR: 'runtime 输入出错',
    RUNTIME_UNKNOWN: 'runtime 输入结果未知',
    ADMISSION_ATTENTION: 'admission 输入需注意',
    ADMISSION_INVALID: 'admission 输入无效',
    ADMISSION_ERROR: 'admission 输入出错',
    ADMISSION_UNKNOWN: 'admission 输入结果未知'
  };

  // Text goes in as text, always — except when the caller hands over an element
  // it has already built. A node assigned to textContent stringifies to
  // "[object HTMLSpanElement]", so a node has to be appended instead.
  function el(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined && content !== null) {
      if (typeof content === 'object' && typeof content.nodeType === 'number') {
        node.appendChild(content);
      } else {
        node.textContent = String(content);
      }
    }
    return node;
  }

  function rows(target, pairs) {
    target.replaceChildren();
    for (var i = 0; i < pairs.length; i += 1) {
      target.appendChild(el('dt', null, pairs[i][0]));
      target.appendChild(el('dd', null, pairs[i][1]));
    }
  }

  function codes(list) {
    var box = el('ul', 'codes');
    if (!list || list.length === 0) {
      box.appendChild(el('li', 'muted', '无'));
      return box;
    }
    for (var i = 0; i < list.length; i += 1) box.appendChild(el('li', null, list[i]));
    return box;
  }

  function codeList(issues) {
    var out = [];
    if (!issues) return out;
    for (var i = 0; i < issues.length; i += 1) {
      var code = issues[i] && issues[i].code;
      if (typeof code === 'string' && out.indexOf(code) === -1) out.push(code);
    }
    return out;
  }

  // A word plus its gloss, and a badge only where colour is meaningful.
  function wordCell(word, glossTable) {
    var wrap = el('span');
    var key = typeof word === 'string' ? word : String(word);
    var gloss = glossTable[key];
    wrap.appendChild(el('code', null, key));
    if (gloss) wrap.appendChild(el('span', 'badge', gloss));
    var tone = OUTCOME_TONE[key];
    if (tone) wrap.lastChild.className = 'badge ' + tone;
    return wrap;
  }

  function pairValue(word, glossTable) {
    var span = el('span');
    span.appendChild(wordCell(word, glossTable));
    return span;
  }

  function sourceCard(label, block) {
    var card = el('div', 'card');
    card.appendChild(el('h3', null, label));
    if (!block || typeof block !== 'object') {
      card.appendChild(el('p', 'muted', '信封里没有这一项。'));
      return card;
    }
    var source = block.source && typeof block.source === 'object' ? block.source : null;
    var dl = el('dl', 'rows');
    dl.appendChild(el('dt', null, '状态'));
    dl.appendChild(el('dd', null, pairValue(block.state, STATE_WORDS)));
    dl.appendChild(el('dt', null, '结论'));
    dl.appendChild(el('dd', null, pairValue(block.outcome, OUTCOME_WORDS)));
    dl.appendChild(el(
      'dt', null, '来源'
    ));
    dl.appendChild(el(
      'dd', null, source ? (source.name || source.path || '（未命名）') : '（无）'
    ));
    if (Object.prototype.hasOwnProperty.call(block, 'entryDiagnostics')) {
      dl.appendChild(el('dt', null, '条目诊断数'));
      dl.appendChild(el('dd', null, String(block.entryDiagnostics)));
    }
    card.appendChild(dl);
    card.appendChild(el('p', 'muted', '问题码'));
    card.appendChild(codes(codeList(block.issues)));

    var details = el('details');
    details.appendChild(el('summary', null, '原始内容'));
    details.appendChild(el('pre', null, JSON.stringify(block, null, 2)));
    card.appendChild(details);
    return card;
  }

  // One card per provenance entry: the four words, and the two strings only when
  // the word is "recorded". This is a separate section from the source cards
  // because provenance is per *source slot*, not per lane: a profile block and a
  // static channel may both exist while neither carries a baseline.
  function provenanceCard(entry) {
    var card = el('div', 'card');
    card.appendChild(el('h3', null, String(entry && entry.source ? entry.source : '（未知来源）')));
    var dl = el('dl', 'rows');
    var state = entry && entry.baselineState;
    dl.appendChild(el('dt', null, '基线'));
    dl.appendChild(el('dd', null, pairValue(state, BASELINE_WORDS)));
    if (state === 'recorded') {
      dl.appendChild(el('dt', null, '提交'));
      dl.appendChild(el('dd', null, String(entry.commit)));
      dl.appendChild(el('dt', null, 'Node'));
      dl.appendChild(el('dd', null, String(entry.node)));
    }
    card.appendChild(dl);
    if (state === 'not-reflected') {
      card.appendChild(el(
        'p', 'muted', '该通道自己存了一份摘要，而那份摘要里没有基线字段。'
      ));
    }
    if (state === 'not-provided') {
      card.appendChild(el('p', 'muted', '此来源未指定任何文档。'));
    }
    if (state === 'not-readable') {
      card.appendChild(el('p', 'muted', '文档已指定，但未产出可用结果。'));
    }
    return card;
  }

  function render(report) {
    var pairs = [
      ['诊断信封版本', report.diagnoseVersion],
      ['认证', String(report.certification)],
      ['相关性', report.correlation]
    ];
    if (report.combinedReport && report.combinedReport.reportVersion) {
      pairs.push(['合并报告版本', report.combinedReport.reportVersion]);
    }
    rows(document.getElementById('identity'), pairs);

    var sources = document.getElementById('sources');
    sources.replaceChildren();
    sources.appendChild(sourceCard('profile 输入', report.profile));
    if (report.combinedReport && report.combinedReport.channels) {
      var channels = report.combinedReport.channels;
      var names = Object.keys(channels);
      for (var i = 0; i < names.length; i += 1) {
        sources.appendChild(sourceCard('通道：' + names[i], channels[names[i]]));
      }
    } else {
      sources.appendChild(el('p', 'muted', '这份信封里没有合并报告（未指定任何通道文档）。'));
    }

    var provenance = document.getElementById('provenance');
    if (provenance) {
      provenance.replaceChildren();
      var entries = Array.isArray(report.provenance) ? report.provenance : [];
      for (var p = 0; p < entries.length; p += 1) provenance.appendChild(provenanceCard(entries[p]));
    }

    var limitations = document.getElementById('limitations');
    limitations.replaceChildren();
    var limits = Array.isArray(report.limitations) ? report.limitations : [];
    if (limits.length === 0) {
      limitations.appendChild(el('li', 'muted', '这份信封没有列出限制。'));
    } else {
      for (var j = 0; j < limits.length; j += 1) limitations.appendChild(el('li', null, limits[j]));
    }

    var nextSteps = document.getElementById('nextSteps');
    nextSteps.replaceChildren();
    var steps = Array.isArray(report.nextSteps) ? report.nextSteps : [];
    if (steps.length === 0) {
      nextSteps.appendChild(el('li', 'muted', '这份信封没有列出后续步骤。'));
    } else {
      for (var k = 0; k < steps.length; k += 1) {
        var step = steps[k] || {};
        var item = el('li');
        item.appendChild(wordCell(step.code || '（无代码）', NEXT_STEP_WORDS));
        if (step.source) item.appendChild(el('span', 'badge', String(step.source)));
        if (step.message) item.appendChild(el('span', 'muted', ' — ' + String(step.message)));
        nextSteps.appendChild(item);
      }
    }
  }

  function fail(text) {
    rows(document.getElementById('identity'), [['状态', '信封无法读取']]);
    var sources = document.getElementById('sources');
    sources.replaceChildren();
    var card = el('div', 'card refused');
    card.appendChild(el('p', null, '这封信封无法提供，因此本页没有可显示的内容。'));
    card.appendChild(el('pre', null, text || '（无详情）'));
    sources.appendChild(card);
    document.getElementById('limitations').replaceChildren(el('li', 'muted', '不可用'));
    document.getElementById('nextSteps').replaceChildren(el('li', 'muted', '不可用'));
  }

  fetch(ENVELOPE_URL, { headers: { accept: 'application/json' }, cache: 'no-store' })
    .then(function (response) {
      return response.text().then(function (text) {
        if (!response.ok) {
          fail('HTTP ' + response.status + '\\n' + text);
          return null;
        }
        try {
          return JSON.parse(text);
        } catch (error) {
          fail('响应不是 JSON：' + String(error));
          return null;
        }
      });
    })
    .then(function (report) {
      if (report) render(report);
    })
    .catch(function (error) {
      fail(String(error));
    });

  // ── Live tools: page snapshot & frontend log ──────────────────────
  var btnSnapshot = document.getElementById('btnSnapshot');
  var snapshotResult = document.getElementById('snapshotResult');
  var snapshotOutput = document.getElementById('snapshotOutput');

  btnSnapshot.addEventListener('click', function () {
    btnSnapshot.disabled = true;
    btnSnapshot.textContent = '采集中...';
    snapshotOutput.textContent = '';
    snapshotResult.open = false;

    fetch('/api/page-snapshot', { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then(function (response) {
        return response.text().then(function (text) {
          if (!response.ok) {
            snapshotOutput.textContent = 'HTTP ' + response.status + '\\n' + text;
            snapshotResult.open = true;
            return null;
          }
          try {
            var data = JSON.parse(text);
            snapshotOutput.textContent = JSON.stringify(data, null, 2);
            snapshotResult.open = true;
            return data;
          } catch (error) {
            snapshotOutput.textContent = '响应不是 JSON: ' + String(error) + '\\n' + text;
            snapshotResult.open = true;
            return null;
          }
        });
      })
      .catch(function (error) {
        snapshotOutput.textContent = String(error);
        snapshotResult.open = true;
      })
      .finally(function () {
        btnSnapshot.disabled = false;
        btnSnapshot.textContent = '采集快照';
      });
  });

  var wsStatus = document.getElementById('wsStatus');
  var btnLogConnect = document.getElementById('btnLogConnect');
  var btnLogDisconnect = document.getElementById('btnLogDisconnect');
  var btnLogClear = document.getElementById('btnLogClear');
  var logList = document.getElementById('logList');
  var ws = null;

  function setWsStatus(status, text) {
    wsStatus.className = 'ws-status ' + status;
    wsStatus.textContent = text;
  }

  function addLogEntry(time, level, msg) {
    var entry = el('div', 'log-entry');
    entry.appendChild(el('span', 'time', time));
    entry.appendChild(el('span', 'level ' + level, level.toUpperCase()));
    entry.appendChild(el('span', 'msg', msg));
    logList.appendChild(entry);
    logList.scrollTop = logList.scrollHeight;
  }

  btnLogConnect.addEventListener('click', function () {
    if (ws) return;
    btnLogConnect.disabled = true;
    setWsStatus('connecting', '连接中...');

    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = protocol + '//' + window.location.host + '/api/frontend-log';
    ws = new WebSocket(wsUrl);

    ws.onopen = function () {
      setWsStatus('connected', '已连接');
      btnLogDisconnect.disabled = false;
      addLogEntry(new Date().toLocaleTimeString(), 'info', 'WebSocket 已连接');
    };

    ws.onmessage = function (event) {
      try {
        var msg = JSON.parse(event.data);
        if (msg && msg.time && msg.level && msg.message) {
          var time = new Date(msg.time).toLocaleTimeString();
          addLogEntry(time, msg.level, msg.message);
        }
      } catch (error) {
        addLogEntry(new Date().toLocaleTimeString(), 'error', '解析日志失败: ' + String(error));
      }
    };

    ws.onerror = function () {
      addLogEntry(new Date().toLocaleTimeString(), 'error', 'WebSocket 连接错误');
    };

    ws.onclose = function () {
      setWsStatus('', '未连接');
      btnLogConnect.disabled = false;
      btnLogDisconnect.disabled = true;
      addLogEntry(new Date().toLocaleTimeString(), 'info', 'WebSocket 已断开');
      ws = null;
    };
  });

  btnLogDisconnect.addEventListener('click', function () {
    if (ws) {
      ws.close();
      ws = null;
    }
  });

  btnLogClear.addEventListener('click', function () {
    logList.replaceChildren();
  });
}());
</script>
</body>
</html>
`
}
