// Fixture: an activation that never yields.
//
// A promise that never settles is not enough: this loader does not await an
// `apply()` return value for a plain plugin, so the boot finishes anyway. The
// only way to make the boot itself stop making progress is to block the event
// loop, which is also what a real runaway activation looks like from outside.
// The supervisor's phase budget must then kill it and reap it.
export const name = 'fixture-hang'

export function apply() {
  for (;;) {
    // never yields
  }
}
