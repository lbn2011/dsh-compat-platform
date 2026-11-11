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
 */

/** Content type of the page response. */
export const PAGE_CONTENT_TYPE = 'text/html; charset=utf-8'

/**
 * Render the read-only diagnostics page.
 *
 * @returns {string} The complete HTML document.
 */
export function renderPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; form-action 'none'; base-uri 'none'">
<title>兼容性诊断 · 只读</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #f6f7fb;
  --surface: #ffffff;
  --ink: #1b1b20;
  --ink-soft: #5a5a68;
  --ink-faint: #8a8a99;
  --line: #e2e3ec;
  --accent: #3b5bdb;
  --warn: #b08419;
  --warn-bg: #fdf6e3;
  --bad: #b02a2a;
  --bad-bg: #fdeeee;
  --shadow: 0 1px 2px rgba(20, 20, 40, 0.05), 0 6px 18px rgba(20, 20, 40, 0.05);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #131318;
    --surface: #1b1b22;
    --ink: #e8e8f0;
    --ink-soft: #a8a8bb;
    --ink-faint: #767688;
    --line: #2b2b36;
    --accent: #8fa6ff;
    --warn: #e0b850;
    --warn-bg: #302916;
    --bad: #ff8b8b;
    --bad-bg: #331c1c;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 6px 18px rgba(0, 0, 0, 0.3);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2rem 1.5rem 7rem;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC",
        "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 62rem; margin: 0 auto; }
h1 { font-size: 1.35rem; margin: 0; letter-spacing: 0.01em; }
h2 {
  font-size: 0.82rem; margin: 2rem 0 0.75rem; color: var(--ink-faint);
  font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
}
h3 { font-size: 0.95rem; margin: 0 0 0.55rem; font-weight: 600; }
p { margin: 0.35rem 0; }
.muted { color: var(--ink-soft); font-size: 0.9rem; }
code, pre, .mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.86em;
}
code { background: var(--line); border-radius: 3px; padding: 0.05em 0.35em; }
header.top { padding-bottom: 1rem; border-bottom: 1px solid var(--line); }
.claim {
  margin: 1.1rem 0 0;
  padding: 0.9rem 1rem;
  border-left: 3px solid var(--warn);
  border-radius: 6px;
  background: var(--warn-bg);
  color: var(--ink);
}
.claim strong { display: block; margin-bottom: 0.25rem; }
.claim .literals { color: var(--ink-soft); font-size: 0.86rem; }
.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 1rem 1.1rem;
  box-shadow: var(--shadow);
}
dl.rows {
  display: grid; grid-template-columns: max-content 1fr;
  gap: 0.3rem 1.1rem; margin: 0;
}
dl.rows dt { color: var(--ink-soft); font-size: 0.86rem; }
dl.rows dd { margin: 0; overflow-wrap: anywhere; }
.grid { display: grid; gap: 0.85rem; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); }
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0.9rem 1rem;
  box-shadow: var(--shadow);
}
.card.refused { border-color: var(--bad); background: var(--bad-bg); }
.badge {
  display: inline-block; margin-left: 0.4rem; padding: 0 0.45rem;
  border: 1px solid var(--line); border-radius: 999px;
  font-size: 0.72rem; color: var(--ink-soft); vertical-align: 1px;
}
.badge.warn { border-color: var(--warn); color: var(--warn); }
.badge.bad { border-color: var(--bad); color: var(--bad); }
ul.codes { list-style: none; padding: 0; margin: 0.35rem 0 0; display: flex; flex-wrap: wrap; gap: 0.35rem; }
ul.codes > li {
  border: 1px solid var(--line); border-radius: 4px; padding: 0.05rem 0.4rem;
  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.78rem;
  color: var(--ink-soft);
}
ul.plain { margin: 0; padding-left: 1.15rem; }
ul.plain > li { margin: 0.2rem 0; }
details { margin-top: 0.6rem; }
summary { cursor: pointer; color: var(--ink-faint); font-size: 0.82rem; }
pre {
  margin: 0.45rem 0 0; padding: 0.7rem; overflow: auto; max-height: 24rem;
  background: var(--bg); border: 1px solid var(--line); border-radius: 6px;
  font-size: 0.78rem; line-height: 1.5;
}
footer {
  position: fixed; inset: auto 0 0 0; padding: 0.7rem 1.5rem;
  background: var(--surface); border-top: 1px solid var(--line);
  color: var(--ink-soft); font-size: 0.78rem; z-index: 2;
}
footer .wrap { max-width: 62rem; margin: 0 auto; }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
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

  var ENVELOPE_URL = '/compat-diagnostics/envelope';

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
        var line = String(step.code || '（无代码）');
        if (step.source) line += ' · ' + String(step.source);
        if (step.message) line += ' — ' + String(step.message);
        nextSteps.appendChild(el('li', null, line));
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
}());
</script>
</body>
</html>
`
}
