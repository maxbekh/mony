# Security Policy (SECURITY.md)

## Our Commitment to Security

**mony** is designed as a personal finance tool where data privacy and security are top priorities. Security is integrated from the design phase, and we strive to maintain a clean, secure codebase.

## Reporting a Vulnerability

If you discover a security vulnerability, do not open a public issue.

Report vulnerabilities through GitHub's private vulnerability reporting for this repository:

- [Repository Security Page](https://github.com/maxbekh/mony/security)
- [Open a Private Security Advisory](https://github.com/maxbekh/mony/security/advisories/new)

Use the `Report a vulnerability` button from the repository Security tab when it is available.

If private vulnerability reporting is temporarily unavailable, open a public issue that requests a private security contact channel but do not include vulnerability details in that issue.

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

## Authentication & Authorization Baseline

- **Protected by Default**: Application routes under `/v1/*` should require authentication unless they are explicitly documented as public bootstrap or auth endpoints.
- **Bootstrap-Only Account Creation**: Public self-service registration is out of scope. Initial user creation should be limited to a one-time bootstrap flow while no account exists.
- **Password Handling**: Local passwords must be hashed with Argon2id. Plaintext passwords, reversible encryption, and weak password hashing schemes are not acceptable.
- **Short-Lived Access Tokens**: API access should rely on short-lived asymmetric JWT access tokens with strict validation of `alg`, `iss`, `aud`, `exp`, `nbf`, and `jti`.
- **Refresh Token Safety**: Refresh tokens should be opaque, random, hashed at rest, rotated on use, and grouped into token families so suspicious reuse can revoke the whole session.
- **Session Traceability**: Authenticated sessions should be individually identifiable and revocable, with device and audit metadata recorded for sensitive events.
- **Web Token Storage**: Browser access tokens must stay in memory only. Refresh tokens should be delivered in `HttpOnly`, `Secure` cookies and paired with CSRF protections on refresh/logout endpoints.
- **Future OIDC Compatibility**: Internal auth boundaries should stay compatible with a later migration to an external OIDC/OAuth2 provider without rewriting application authorization logic.
