# Security Policy (SECURITY.md)

## Our Commitment to Security

**mony** is designed as a personal finance tool where data privacy and security are top priorities. Security is integrated from the design phase, and we strive to maintain a clean, secure codebase.

## Reporting a Vulnerability

If you discover a security vulnerability, do not open a public issue.

Until the project has a dedicated security mailbox or a private advisory channel on its forge, report vulnerabilities privately to the repository maintainer using the direct collaboration channel already used for this repository (private message or private email shared out of band).

When reporting an issue, include:

- A clear description of the problem and impact.
- Steps to reproduce, proof of concept, or a minimal sample.
- The affected commit, branch, or file if known.
- Any suggested mitigation if you already identified one.

We aim to acknowledge reports within 72 hours and provide a remediation plan or status update after triage.

## Security Practices

- **Minimal Dependencies**: We keep dependencies to a minimum and only use well-vetted libraries.
- **Regular Updates**: We aim to keep dependencies updated to avoid known vulnerabilities.
- **Local Data Storage**: Financial data is meant to be stored locally or on a user-controlled server, never on third-party cloud services.
- **Encryption**: Sensitive data should be encrypted at rest and in transit (e.g., using TLS/HTTPS for web-based access).
- **No Telemetry**: The application does not collect usage data or metrics.
- **Private Disclosure**: Security reports are handled privately until a fix is available and affected users can upgrade safely.
