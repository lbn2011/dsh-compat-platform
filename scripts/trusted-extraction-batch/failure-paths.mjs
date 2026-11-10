// Exercises the two failure paths the extraction slice previously only asserted.
//
// 1. The isolation probe makes one outbound attempt from inside the sandbox and
//    reports the errno. The gate verdict is then computed from that observation,
//    not from the fact that the launcher passed --unshare-net.
// 2. A fixture whose activation never settles is run under a phase budget so the
//    kill path is demonstrated. The receipt must be `incomplete` with
//    `cleanup: unconfirmed` and `process.timedOut: true`.
//
// Two budget profiles exist. `demo` uses a reduced budget so the mechanism is
// visible in seconds inside a batch that does other work too. `shipped` uses the
// policy's own BUDGET (80 s phase), which is what the product would actually run;
// it needs its own bounded round because 80 + 10 + 20 seconds does not fit
// alongside the rest of a batch inside a 120 s envelope.

import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { probeIsolation, observeFixture } from '../../packages/runtime/src/trusted-extraction-supervisor.js'
import { BUDGET, checkBudget } from '../../packages/runtime/src/isolation-policy.js'

const DEMO_BUDGET = Object.freeze({
  outerSeconds: 30,
  phaseSeconds: 3,
  killGraceSeconds: 2,
  readbackSeconds: 2,
})

// The shipped budget is not restated here: it is taken from the policy module so
// this suite cannot drift from what the product enforces.
const BUDGET_PROFILES = Object.freeze({ demo: DEMO_BUDGET, shipped: BUDGET })

function parseArgs(argv) {
  const args = { installation: null, modulesRoot: null, hangConfig: null, out: null, sentinels: [], budgetProfile: 'demo' }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--installation') args.installation = argv[(i += 1)]
    else if (flag === '--modules-root') args.modulesRoot = argv[(i += 1)]
    else if (flag === '--hang-config') args.hangConfig = argv[(i += 1)]
    else if (flag === '--out') args.out = argv[(i += 1)]
    else if (flag === '--sentinel') args.sentinels.push(argv[(i += 1)])
    else if (flag === '--budget-profile') args.budgetProfile = argv[(i += 1)]
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.installation === null || args.modulesRoot === null || args.hangConfig === null || args.out === null) {
    process.stderr.write(
      'failure-paths: --installation, --modules-root, --hang-config and --out are required\n',
    )
    process.exitCode = 64
    return
  }

  const budget = BUDGET_PROFILES[args.budgetProfile]
  if (budget === undefined) {
    process.stderr.write('failure-paths: --budget-profile must be demo or shipped\n')
    process.exitCode = 64
    return
  }
  const budgetRefusal = checkBudget(budget)
  if (budgetRefusal !== null) {
    process.stderr.write('failure-paths: the ' + args.budgetProfile + ' budget is not self-consistent\n')
    process.exitCode = 64
    return
  }

  // At least one sentinel is required: with none, "every sentinel read failed"
  // is vacuously true and the gate would pass without testing anything.
  const sentinels =
    args.sentinels.length > 0
      ? args.sentinels
      : [resolve(import.meta.dirname, '../../README.md')]

  const isolation = probeIsolation({ keepDir: args.out, sentinels })
  writeFileSync(
    join(args.out, 'isolation.json'),
    JSON.stringify(
      {
        gates: isolation.gates,
        sentinelVerdict: isolation.observations?.sentinelVerdict ?? null,
        networkAttempt: isolation.observations?.networkAttempt ?? null,
      },
      null,
      2,
    ),
  )

  const hang = observeFixture({
    installationRoot: args.installation,
    modulesRoot: args.modulesRoot,
    configPath: args.hangConfig,
    sentinels,
    budget,
    keepDir: join(args.out, 'hang'),
  })
  writeFileSync(join(args.out, 'hang.json'), JSON.stringify(hang.receipt, null, 2))
  writeFileSync(join(args.out, 'hang-budget.json'), JSON.stringify({ profile: args.budgetProfile, ...budget }, null, 2))

  const receipt = hang.receipt
  const checks = {
    isolationGate: isolation.gates.gate === null && isolation.gates.refusal === null,
    networkDenied: isolation.observations?.sentinelVerdict?.networkConnect === 'denied',
    networkCodeRecorded: typeof isolation.observations?.networkAttempt?.code === 'string',
    hangIncomplete: receipt.status === 'incomplete',
    hangCleanupUnconfirmed: receipt.cleanup === 'unconfirmed',
    hangTimedOut: receipt.process?.timedOut === true,
  }
  const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name)
  writeFileSync(
    join(args.out, 'failure-paths.json'),
    JSON.stringify({ budgetProfile: args.budgetProfile, budget, checks, failed }, null, 2),
  )
  process.stdout.write(
    'failure-paths: budget=' + args.budgetProfile + ' network=' +
      String(isolation.observations?.networkAttempt?.code) +
      ' hang=' +
      receipt.status +
      '/' +
      receipt.cleanup +
      ' failed=' +
      (failed.length === 0 ? 'none' : failed.join(',')) +
      '\n',
  )
  process.exitCode = failed.length === 0 ? 0 : 3
}

main()
