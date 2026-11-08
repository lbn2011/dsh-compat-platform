export const name = 'fixture-activate-throw'
export function apply() {
  throw new Error('fixture: activation refused by design')
}
