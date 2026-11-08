/**
 * Deterministic JSON serialization of an analysis report.
 *
 * The report is assembled field by field in a fixed order: object key order and
 * array order never depend on input declaration order, locale or time. Two
 * runs over the same bytes produce byte-identical output.
 *
 * @packageDocumentation
 */

import { EXIT_CODES } from './exit-codes.js';

/**
 * Serialize a report from {@link analyze} as pretty-printed JSON.
 *
 * @param {object} report Frozen report returned by analyze().
 * @returns {string} JSON text ending in a single newline.
 */
export function formatReportJson(report) {
  if (typeof report !== 'object' || report === null || !Array.isArray(report.findings)) {
    throw new TypeError('formatReportJson expects a report object returned by analyze().');
  }

  const document = {
    evidenceLevel: report.evidenceLevel,
    findings: report.findings.map((finding) => {
      const entry = {
        code: finding.code,
        severity: finding.severity,
        pluginIds: [...finding.pluginIds],
      };
      if (finding.resource !== undefined) {
        entry.resource = {
          kind: finding.resource.kind,
          name: finding.resource.name,
          scope: finding.resource.scope,
        };
      }
      entry.message = finding.message;
      return entry;
    }),
    limitations: report.limitations.map((limitation) => ({
      code: limitation.code,
      message: limitation.message,
    })),
  };
  if (report.summary !== undefined) document.summary = report.summary;

  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * Map a report to the process exit code a CLI should use. The library never
 * exits: callers decide, and can always read the report first.
 *
 * @param {object} report
 * @returns {0|1}
 */
export function exitCodeFor(report) {
  const hasError = Array.isArray(report?.findings)
    ? report.findings.some((finding) => finding.severity === 'error')
    : true;
  return hasError ? EXIT_CODES.FINDINGS : EXIT_CODES.OK;
}
