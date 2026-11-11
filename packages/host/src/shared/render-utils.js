/**
 * render-utils — shared DOM rendering utilities for all pages.
 *
 * WHAT THIS MODULE IS: pure functions that build DOM nodes with textContent
 * (never innerHTML), to be shared across diagnostics-ui, conflict-detect,
 * patch-manager, and other pages.
 *
 * WHY TEXTCONTENT ONLY: a node assigned to textContent stringifies to
 * "[object HTMLSpanElement]", so we explicitly handle both string and node
 * content. User input MUST flow through textContent to prevent XSS.
 */

/**
 * Create a DOM element with optional className and content.
 *
 * @param {string} tag - The HTML tag name.
 * @param {string|null} className - Optional class name(s).
 * @param {string|number|Node|null} content - Text, number, or an existing node.
 * @returns {HTMLElement} The created element.
 */
export function el(tag, className, content) {
  var node = document.createElement(tag)
  if (className) node.className = className
  if (content !== undefined && content !== null) {
    if (typeof content === 'object' && typeof content.nodeType === 'number') {
      node.appendChild(content)
    } else {
      node.textContent = String(content)
    }
  }
  return node
}

/**
 * Replace a <dl> element's children with key-value pairs.
 *
 * @param {HTMLElement} target - The <dl> element to populate.
 * @param {Array<[string, string|number|Node]>} pairs - Array of [key, value] tuples.
 */
export function rows(target, pairs) {
  target.replaceChildren()
  for (var i = 0; i < pairs.length; i += 1) {
    target.appendChild(el('dt', null, pairs[i][0]))
    target.appendChild(el('dd', null, pairs[i][1]))
  }
}

/**
 * Create a <ul class="codes"> element from an array of code strings.
 *
 * @param {Array<string>|null} list - Array of code strings, or null.
 * @returns {HTMLElement} The <ul> element.
 */
export function codes(list) {
  var box = el('ul', 'codes')
  if (!list || list.length === 0) {
    box.appendChild(el('li', 'muted', '无'))
    return box
  }
  for (var i = 0; i < list.length; i += 1) {
    box.appendChild(el('li', null, list[i]))
  }
  return box
}

/**
 * Extract unique issue codes from an issues array.
 *
 * @param {Array<{code: string}>|null} issues - Array of issue objects.
 * @returns {Array<string>} Unique code strings.
 */
export function codeList(issues) {
  var out = []
  if (!issues) return out
  for (var i = 0; i < issues.length; i += 1) {
    var code = issues[i] && issues[i].code
    if (typeof code === 'string' && out.indexOf(code) === -1) {
      out.push(code)
    }
  }
  return out
}

/**
 * Create a word cell: <code>word</code> + optional <span class="badge">gloss</span>.
 * Adds tone class (warn/bad/good) if the word is in OUTCOME_TONE.
 *
 * @param {string|number} word - The machine word.
 * @param {Object<string, string>} glossTable - Word → Chinese gloss mapping.
 * @param {Object<string, string>} [toneTable] - Word → tone mapping (warn/bad/good).
 * @returns {HTMLElement} A <span> containing <code> + optional badge.
 */
export function wordCell(word, glossTable, toneTable) {
  var wrap = el('span')
  var key = typeof word === 'string' ? word : String(word)
  var gloss = glossTable[key]
  
  wrap.appendChild(el('code', null, key))
  
  if (gloss) {
    var badge = el('span', 'badge', gloss)
    var tone = toneTable && toneTable[key]
    if (tone) badge.className = 'badge ' + tone
    wrap.appendChild(badge)
  }
  
  return wrap
}

/**
 * Create a pair value wrapper for dl.rows: wraps wordCell in a <span>.
 *
 * @param {string|number} word - The machine word.
 * @param {Object<string, string>} glossTable - Word → Chinese gloss mapping.
 * @param {Object<string, string>} [toneTable] - Word → tone mapping.
 * @returns {HTMLElement} A <span> wrapper.
 */
export function pairValue(word, glossTable, toneTable) {
  var span = el('span')
  span.appendChild(wordCell(word, glossTable, toneTable))
  return span
}

/**
 * Create a card element with heading, optional empty state, and content.
 *
 * @param {string} title - Card heading.
 * @param {Object|null} data - Data object; null triggers empty state.
 * @param {Function} renderContent - Function(data) → Array<Node> to append.
 * @returns {HTMLElement} The .card element.
 */
export function card(title, data, renderContent) {
  var cardEl = el('div', 'card')
  cardEl.appendChild(el('h3', null, title))
  
  if (!data || typeof data !== 'object') {
    cardEl.appendChild(el('p', 'muted', '信封里没有这一项。'))
    return cardEl
  }
  
  var content = renderContent(data)
  for (var i = 0; i < content.length; i += 1) {
    cardEl.appendChild(content[i])
  }
  
  return cardEl
}

/**
 * Create a <details> element with summary and pre-formatted JSON content.
 *
 * @param {string} summaryText - The <summary> text.
 * @param {Object} data - The object to JSON.stringify.
 * @returns {HTMLElement} The <details> element.
 */
export function detailsJSON(summaryText, data) {
  var details = el('details')
  details.appendChild(el('summary', null, summaryText))
  details.appendChild(el('pre', null, JSON.stringify(data, null, 2)))
  return details
}

/**
 * Create a badge element with optional tone.
 *
 * @param {string} text - Badge text.
 * @param {string} [tone] - Optional tone class: 'warn', 'bad', 'good'.
 * @returns {HTMLElement} The badge <span>.
 */
export function badge(text, tone) {
  var className = tone ? 'badge ' + tone : 'badge'
  return el('span', className, text)
}

/**
 * Create a button element.
 *
 * @param {string} text - Button text.
 * @param {string} [variant='primary'] - Button variant: 'primary' or 'secondary'.
 * @param {Function} [onClick] - Optional click handler.
 * @returns {HTMLElement} The button element.
 */
export function button(text, variant, onClick) {
  var className = variant === 'secondary' ? 'btn btn-secondary' : 'btn btn-primary'
  var btn = el('button', className, text)
  if (onClick) btn.addEventListener('click', onClick)
  return btn
}

/**
 * Show a loading placeholder in a target element.
 *
 * @param {HTMLElement} target - The container element.
 * @param {string} [message='加载中…'] - Loading message.
 */
export function showLoading(target, message) {
  target.replaceChildren()
  target.appendChild(el('p', 'muted', message || '加载中…'))
}

/**
 * Show an error state in a target element.
 *
 * @param {HTMLElement} target - The container element.
 * @param {string} errorMessage - The error message.
 */
export function showError(target, errorMessage) {
  target.replaceChildren()
  var errorCard = el('div', 'card refused')
  errorCard.appendChild(el('p', null, '无法加载数据'))
  errorCard.appendChild(el('pre', null, errorMessage || '（无详情）'))
  target.appendChild(errorCard)
}

/**
 * Format a timestamp to a readable Chinese string.
 *
 * @param {string|number|Date} timestamp - ISO string, Unix ms, or Date object.
 * @returns {string} Formatted string like "2026-11-12 03:19:00".
 */
export function formatTimestamp(timestamp) {
  var date = typeof timestamp === 'object' ? timestamp : new Date(timestamp)
  if (isNaN(date.getTime())) return String(timestamp)
  
  var pad = function (n) { return n < 10 ? '0' + n : String(n) }
  
  return (
    date.getFullYear() + '-' +
    pad(date.getMonth() + 1) + '-' +
    pad(date.getDate()) + ' ' +
    pad(date.getHours()) + ':' +
    pad(date.getMinutes()) + ':' +
    pad(date.getSeconds())
  )
}

/**
 * Create an empty state message.
 *
 * @param {string} message - The message text.
 * @returns {HTMLElement} A <p class="muted"> element.
 */
export function emptyState(message) {
  return el('p', 'muted', message || '暂无数据')
}
