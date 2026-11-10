#!/usr/bin/env python3
"""Publish-readiness audit for the four packages, read from their own tarballs.

What this answers, and nothing more:

  * does each tarball contain only files its `files` allowlist implies
    (`package.json`, `README.md`, `LICENSE`, `src/**`)? npm always adds `LICENSE`
    when one exists, so it is allowlisted rather than treated as a stray file.
  * do the manifests carry the fields a public release needs, and which of them
    are still placeholders?

Two standards are measured, because "not publishable" and "not ready" are
different statements:

  * ``--standard private`` (default) — the target is a *private* release candidate,
    which is what the roadmap asks for (P5: "private release candidate"; "npm scope,
    license, remote, release and publication remain user decisions"). Under this
    standard ``"private": true`` is the intended state, not a blocker.
  * ``--standard public`` — the target is a public npm publication. Here
    ``"private": true`` is a blocker, because it would silently prevent the publish.

Everything else (missing fields, placeholder versions, an undecided license) is a
blocker under both standards.

It does not publish, does not modify a manifest, does not install, and does not
claim that a package is correct — only that its shipped bytes are the bytes the
manifest says they are.
"""

import argparse
import json
import os
import sys
import tarfile

EXPECTED = {
    "analyzer": "dsh-compat-platform",
    "config-check": "@dsh-compat/config-check",
    "host": "dsh-compat-diagnostics-ui",
    "runtime": "dsh-compat-trusted-extraction",
    "repair": "dsh-compat-repair",
}

ALLOWED_EXACT = {"package/package.json", "package/README.md", "package/LICENSE"}
ALLOWED_PREFIX = "package/src/"
PUBLISH_FIELDS = ("name", "version", "description", "license", "engines", "exports")
PLACEHOLDER_VERSIONS = ("0.0.0", "0.0.0-prepared", "0.0.0-draft.1")


def tarball_stem(name):
    """The name npm puts in a tarball filename: no `@`, `/` becomes `-`."""
    return name.lstrip("@").replace("/", "-")


def audit_one(path, dirname, standard):
    findings = []
    with tarfile.open(path, "r:gz") as tar:
        members = sorted(m.name for m in tar.getmembers() if m.isfile())
        manifest = json.load(tar.extractfile("package/package.json"))

    outside = [
        name for name in members
        if name not in ALLOWED_EXACT and not name.startswith(ALLOWED_PREFIX)
    ]
    if outside:
        findings.append({
            "code": "TARBALL_FILE_OUTSIDE_ALLOWLIST",
            "detail": outside[:10],
            "count": len(outside),
        })
    if "package/README.md" not in members:
        findings.append({"code": "TARBALL_MISSING_README", "count": 1})
    if not any(name.startswith(ALLOWED_PREFIX) for name in members):
        findings.append({"code": "TARBALL_MISSING_SOURCES", "count": 1})

    expected_name = EXPECTED[dirname]
    if manifest.get("name") != expected_name:
        findings.append({
            "code": "MANIFEST_NAME_MISMATCH",
            "detail": {"expected": expected_name, "actual": manifest.get("name")},
            "count": 1,
        })

    blockers = []
    for field in PUBLISH_FIELDS:
        if field not in manifest:
            blockers.append({"code": "MISSING_PUBLISH_FIELD", "field": field})
    if manifest.get("private") is True and standard == "public":
        # Under the private standard this is the intended state; under the public
        # standard it would silently block the publish, so it is a blocker there.
        blockers.append({"code": "PRIVATE_FLAG_SET", "field": "private"})
    if manifest.get("version") in PLACEHOLDER_VERSIONS:
        blockers.append({
            "code": "PLACEHOLDER_VERSION",
            "field": "version",
            "value": manifest.get("version"),
        })
    if "license" in manifest and manifest["license"] in (None, "", "UNLICENSED"):
        blockers.append({"code": "LICENSE_NOT_DECIDED", "field": "license"})

    return {
        "directory": dirname,
        "name": manifest.get("name"),
        "version": manifest.get("version"),
        "private": manifest.get("private") is True,
        "standard": standard,
        "files": len(members),
        "bytes": os.path.getsize(path),
        "allowlistViolations": len(outside),
        "findings": findings,
        "publishBlockers": blockers,
    }


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument(
        "--artifacts",
        required=True,
        action="append",
        help="directory holding tarballs; repeatable, because one package may be "
             "packed into its own directory when it cannot join the consumer install",
    )
    parser.add_argument("--repo", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--standard", choices=("private", "public"), default="private")
    args = parser.parse_args()

    packages = []
    total_violations = 0
    for dirname in EXPECTED:
        probe = os.path.join(args.repo, "packages", dirname, "package.json")
        with open(probe, "r", encoding="utf-8") as handle:
            version = json.load(handle).get("version")
        # npm writes a scoped name into the filename as `scope-name-version.tgz`
        # (`@dsh-compat/config-check` becomes `dsh-compat-config-check`), so the
        # prefix is derived the same way rather than from the raw manifest name.
        prefix = f"{tarball_stem(EXPECTED[dirname])}-{version}"
        matches = []
        for artifacts in args.artifacts:
            matches.extend(
                os.path.join(artifacts, name)
                for name in sorted(os.listdir(artifacts))
                if name.endswith(".tgz") and name.startswith(prefix)
            )
        if len(matches) != 1:
            packages.append({
                "directory": dirname,
                "error": "TARBALL_NOT_FOUND",
                "matches": matches,
            })
            total_violations += 1
            continue
        result = audit_one(matches[0], dirname, args.standard)
        packages.append(result)
        total_violations += result["allowlistViolations"]

    document = {
        "auditVersion": "publish-audit/0.1-draft.2",
        "standard": args.standard,
        "certification": False,
        "packages": packages,
        "allowlistViolations": total_violations,
        "limitations": [
            "READS_TARBALL_CONTENTS_ONLY",
            "DOES_NOT_PUBLISH_OR_MODIFY_A_MANIFEST",
            "ALLOWLIST_IS_WHAT_THIS_PACKAGE_DECLARES_NOT_A_SECURITY_REVIEW",
            "BLOCKERS_ARE_DECLARED_NOT_RESOLVED",
            "STANDARD_IS_CHOSEN_BY_THE_CALLER_NOT_INFERRED",
            "AUDITS_TARBALLS_AND_MANIFESTS_ONLY_NEVER_INSTALLS",
        ],
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2, sort_keys=True)
        handle.write("\n")

    print(f"publish-audit: standard={args.standard} packages={len(packages)} allowlist_violations={total_violations}")
    for entry in packages:
        if "error" in entry:
            print(f"  {entry['directory']}: {entry['error']} {entry['matches']}")
            continue
        print(
            f"  {entry['directory']}: files={entry['files']} bytes={entry['bytes']} "
            f"private={entry['private']} violations={entry['allowlistViolations']} "
            f"blockers={len(entry['publishBlockers'])}"
        )
    return 0 if total_violations == 0 else 3


if __name__ == "__main__":
    sys.exit(main())
