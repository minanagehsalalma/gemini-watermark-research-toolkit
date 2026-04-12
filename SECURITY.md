# Security Policy

This repository contains research tooling, not hardened production infrastructure.

## Scope

- The code operates on local PNG files and browser-side image flows.
- The repository should not contain secrets, session cookies, or customer assets.
- Private fixture images should stay out of version control unless they are explicitly cleared for publication.

## Reporting

If you find a security issue, report it privately to the maintainer instead of opening a public issue with exploit details.

## Operational note

Because this is research code:

- outputs should be reviewed manually before being trusted
- browser automation or userscript use should stay on accounts and assets you control
- local debug logs should be treated as potentially sensitive and cleaned before publishing
