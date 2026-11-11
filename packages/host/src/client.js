window.__ModuleLoader__.load({
	id: 'dsh-compat-diagnostics-ui',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		var react = require('react')

		// WHAT THIS FILE IS: the browser half of dsh-compat-diagnostics-ui, written
		// by hand in the shape this installation's Web client loader expects
		// (`window.__ModuleLoader__.load({ id, factory })`). There is no build step:
		// the repository ships the same bytes the browser executes.
		//
		// WHAT IT ADDS: one Settings section that frames the read-only route this
		// package's host half already serves. Framing rather than re-rendering keeps
		// exactly one renderer of the envelope, so the page and the panel can never
		// disagree about what the evidence says.
		//
		// WHAT IT DOES NOT DO: no remote API, no command, no write, no file read. If
		// the host route refuses, the frame shows that refusal; this module cannot
		// paper over it.
		//
		// SLOT: `settings.section` is the section list of the settings dialog. The
		// `slots` client service itself comes from the core client runtime
		// (@deepseek-ai/dsh-cordis-client-runner), not from a plugin package, so it is
		// named in `inject` below but not in the manifest's dsh.client.inject list.

		var NS = 'compat-diagnostics'
		var PAGE_URL = '/compat-diagnostics'

		/** Client services this plugin needs before it can register anything. */
		var inject = ['slots']

		/** The section body: one iframe pointing at the host route. */
		function Panel() {
			return react.createElement('iframe', {
				src: PAGE_URL,
				title: '\u517c\u5bb9\u6027\u8bca\u65ad\uff08\u53ea\u8bfb\uff09',
				loading: 'lazy',
				referrerPolicy: 'no-referrer',
				style: {
					width: '100%',
					minHeight: '34rem',
					height: '100%',
					border: '0',
					borderRadius: '10px',
					background: '#ffffff'
				}
			})
		}

		/** Register the settings section. */
		function apply(ctx) {
			ctx.slots.inject('settings.section', function () {
				return ctx.slots.register(
					{
						name: 'settings.section',
						id: 'compat-diagnostics',
						order: 200,
						label: function () {
							return '\u517c\u5bb9\u6027\u8bca\u65ad'
						}
					},
					Panel
				)
			})
		}

		exports.NS = NS
		exports.PAGE_URL = PAGE_URL
		exports.inject = inject
		exports.Panel = Panel
		exports.apply = apply
		return module.exports
	}
})
