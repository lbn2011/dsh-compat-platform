/**
 * page — the one HTML document this plugin serves.
 *
 * WHAT THIS MODULE IS: a pure function returning a self-contained page. Inline
 * CSS and inline script, no build artefact, no external host, no bundler. The
 * page fetches the envelope from its own origin and renders it with
 * `textContent` everywhere, so nothing inside an evidence document can become
 * markup.
 *
 * WHY IT IS PLAIN LISTS: a diagnostic envelope is a set of named sources with
 * states, outcomes and codes. Rendering it as anything richer (charts, scores,
 * badges) would invent an interpretation the envelope does not contain, and a
 * green badge on this page is exactly the reading the records forbid.
 *
 * WHY THE NON-CLAIMS ARE IN THE MARKUP, NOT IN A COMMENT: a screenshot of this
 * page is the most likely artefact to be quoted later. The literals
 * `certification: false` and `correlation: not-established` therefore sit in the
 * header and in a fixed footer, present before any data loads, so no screenshot
 * can show this page looking like a clean bill of health.
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
<title>Compatibility diagnostics — read-only</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 1.5rem 1.25rem 6rem;
  font: 15px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #1b1b20; background: #fbfbfd;
}
@media (prefers-color-scheme: dark) { body { color: #e6e6ee; background: #16161a; } }
h1 { font-size: 1.15rem; margin: 0 0 0.25rem; }
h2 { font-size: 0.95rem; margin: 1.75rem 0 0.5rem; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.75; }
p, li, dt, dd { margin: 0.2rem 0; }
code { font: inherit; }
.muted { opacity: 0.7; }
.claim {
  border: 1px solid #b08a2a; background: #b08a2a1a;
  padding: 0.6rem 0.75rem; margin: 0.85rem 0; border-radius: 4px;
}
.card { border: 1px solid #8884; border-radius: 4px; padding: 0.7rem 0.85rem; margin: 0.6rem 0; }
.card > h3 { font-size: 0.9rem; margin: 0 0 0.4rem; }
dl.rows { display: grid; grid-template-columns: max-content 1fr; gap: 0.1rem 0.9rem; margin: 0.3rem 0; }
dl.rows dt { opacity: 0.7; }
dl.rows dd { margin: 0; overflow-wrap: anywhere; }
ul.codes { list-style: none; padding-left: 0; display: flex; flex-wrap: wrap; gap: 0.35rem; }
ul.codes > li { border: 1px solid #8884; border-radius: 3px; padding: 0 0.35rem; font-size: 0.85rem; }
details { margin-top: 0.5rem; }
summary { cursor: pointer; opacity: 0.75; font-size: 0.85rem; }
pre { margin: 0.4rem 0 0; padding: 0.55rem; overflow: auto; max-height: 22rem; background: #8881; border-radius: 3px; font-size: 0.82rem; }
footer {
  position: fixed; inset: auto 0 0 0; padding: 0.7rem 1.25rem;
  border-top: 1px solid #8884; background: #fbfbfdf2; font-size: 0.8rem;
}
@media (prefers-color-scheme: dark) { footer { background: #16161af2; } }
.error { border: 1px solid #a33; background: #a3311a; padding: 0.6rem 0.75rem; border-radius: 4px; }
</style>
</head>
<body>
<h1>Compatibility diagnostics — read-only</h1>
<p class="muted">Displays one existing <code>dsh-compat-diagnose</code> envelope. It re-runs nothing.</p>

<div class="claim">
  <p><strong>This page establishes nothing about compatibility.</strong></p>
  <p><code>certification: false</code> · <code>correlation: not-established</code></p>
</div>

<section>
  <h2>Envelope</h2>
  <dl class="rows" id="identity"><dt>loading</dt><dd>…</dd></dl>
</section>

<section>
  <h2>Sources</h2>
  <div id="sources"><p class="muted">loading…</p></div>
</section>

<section>
  <h2>Baseline per source</h2>
  <p class="muted">What this envelope could read about each source own baseline. "not-reflected" means the lane summary carries no baseline field; it never means the document had none.</p>
  <div id="provenance"><p class="muted">loading…</p></div>
</section>

<section>
  <h2>Limitations (complete list)</h2>
  <ul id="limitations"><li class="muted">loading…</li></ul>
</section>

<section>
  <h2>Next steps</h2>
  <ul id="nextSteps"><li class="muted">loading…</li></ul>
</section>

<footer>
  Read-only view of one envelope file. No plugin was loaded, no host ran, no
  analysis is performed here, and nothing on this page may be quoted as a
  compatibility, loadability or certification result.
</footer>

<script>
(function () {
  'use strict';

  var ENVELOPE_URL = '/compat-diagnostics/envelope';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
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
      box.appendChild(el('li', 'muted', 'none'));
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

  function sourceCard(label, block) {
    var card = el('div', 'card');
    card.appendChild(el('h3', null, label));
    if (!block || typeof block !== 'object') {
      card.appendChild(el('p', 'muted', 'not present in this envelope'));
      return card;
    }
    var source = block.source && typeof block.source === 'object' ? block.source : null;
    var pairs = [
      ['state', block.state],
      ['outcome', block.outcome],
      ['source', source ? (source.name || source.path || '(unnamed)') : '(none)']
    ];
    if (Object.prototype.hasOwnProperty.call(block, 'entryDiagnostics')) {
      pairs.push(['entry diagnostics', block.entryDiagnostics]);
    }
    var dl = el('dl', 'rows');
    rows(dl, pairs);
    card.appendChild(dl);
    card.appendChild(el('p', 'muted', 'issue codes'));
    card.appendChild(codes(codeList(block.issues)));

    var details = el('details');
    details.appendChild(el('summary', null, 'verbatim block'));
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
    card.appendChild(el('h3', null, String(entry && entry.source ? entry.source : '(unknown source)')));
    var pairs = [['baseline', entry && entry.baselineState]];
    if (entry && entry.baselineState === 'recorded') {
      pairs.push(['commit', entry.commit]);
      pairs.push(['node', entry.node]);
    }
    var dl = el('dl', 'rows');
    rows(dl, pairs);
    card.appendChild(dl);
    if (entry && entry.baselineState === 'not-reflected') {
      card.appendChild(el('p', 'muted', 'this lane stores its own summary; that summary carries no baseline field'));
    }
    if (entry && entry.baselineState === 'not-provided') {
      card.appendChild(el('p', 'muted', 'no document was named for this source'));
    }
    if (entry && entry.baselineState === 'not-readable') {
      card.appendChild(el('p', 'muted', 'the document was named but produced no usable result'));
    }
    return card;
  }

  function render(report) {
    var pairs = [
      ['diagnose version', report.diagnoseVersion],
      ['certification', String(report.certification)],
      ['correlation', report.correlation]
    ];
    if (report.combinedReport && report.combinedReport.reportVersion) {
      pairs.push(['report version', report.combinedReport.reportVersion]);
    }
    rows(document.getElementById('identity'), pairs);

    var sources = document.getElementById('sources');
    sources.replaceChildren();
    sources.appendChild(sourceCard('profile input', report.profile));
    if (report.combinedReport && report.combinedReport.channels) {
      var channels = report.combinedReport.channels;
      var names = Object.keys(channels);
      for (var i = 0; i < names.length; i += 1) {
        sources.appendChild(sourceCard('channel: ' + names[i], channels[names[i]]));
      }
    } else {
      sources.appendChild(el('p', 'muted', 'no combined report in this envelope (no lane documents were named)'));
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
      limitations.appendChild(el('li', 'muted', 'the envelope lists no limitations'));
    } else {
      for (var j = 0; j < limits.length; j += 1) limitations.appendChild(el('li', null, limits[j]));
    }

    var nextSteps = document.getElementById('nextSteps');
    nextSteps.replaceChildren();
    var steps = Array.isArray(report.nextSteps) ? report.nextSteps : [];
    if (steps.length === 0) {
      nextSteps.appendChild(el('li', 'muted', 'the envelope lists no next steps'));
    } else {
      for (var k = 0; k < steps.length; k += 1) {
        var step = steps[k] || {};
        var line = String(step.code || '(no code)');
        if (step.source) line += ' · ' + String(step.source);
        if (step.message) line += ' — ' + String(step.message);
        nextSteps.appendChild(el('li', null, line));
      }
    }
  }

  function fail(text) {
    var box = document.getElementById('identity');
    rows(box, [['status', 'envelope refused']]);
    var sources = document.getElementById('sources');
    sources.replaceChildren();
    var card = el('div', 'card error');
    card.appendChild(el('p', null, 'The envelope could not be served, so nothing is displayed.'));
    card.appendChild(el('pre', null, text || '(no detail)'));
    sources.appendChild(card);
    document.getElementById('limitations').replaceChildren(el('li', 'muted', 'unavailable'));
    document.getElementById('nextSteps').replaceChildren(el('li', 'muted', 'unavailable'));
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
          fail('response was not JSON: ' + String(error));
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
