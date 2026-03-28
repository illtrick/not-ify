# PII Cleanup Audit

Scan date: 2026-03-27 | Scope: all committed files

---

## Remove — Private IP Addresses

These expose specific internal network topology and should be replaced.

| File | Line | Current | Replacement |
|------|------|---------|-------------|
| `packages/shared/src/api-client.js` | 5 | `http://192.168.1.50:3000` (in JSDoc comment) | `http://<server-ip>:3000` |
| `packages/server/__tests__/unit/stream-auth.test.js` | 12 | `http://192.168.1.100:3000` | `http://10.0.0.1:3000` |
| `packages/server/__tests__/api/cast.test.js` | 76 | `192.168.1.50` and `http://192.168.1.50:1400/desc` | `10.0.0.50` / `http://10.0.0.50:1400/desc` |

## Remove — Real Names in Changelog

| File | Line | Current | Replacement |
|------|------|---------|-------------|
| `CHANGELOG.md` | 96 | `` `nathan`, `sarah`, `default` users removed from DB seeding `` | `hardcoded seed users removed from DB seeding` |

---

## Review — Confirm These Are Acceptable

These items reference real products/platforms but contain no credentials or PII. Flagged only for your sign-off.

| File | Content | Why flagged |
|------|---------|-------------|
| `docker/gluetun.env.example` | `PIA_USERNAME=your-pia-username` | Placeholder only — confirms PIA is the VPN provider |
| `scripts/qnap-setup.sh` | QNAP platform references throughout | Generic NAS platform support, no host-specific info |
| `scripts/bootstrap.sh:287` | `DEFAULT_INSTALL="/share/CACHEDEV1_DATA/not-ify"` | Standard QNAP storage path — not instance-specific |
| `.env.example` | `GITHUB_USER=illtrick` | Public project owner (you said you don't care about this) |

---

## Recommended — Optional Polish

Low-risk items that aren't leaking anything sensitive but could be tidied.

| File | Content | Suggestion |
|------|---------|------------|
| `CHANGELOG.md:195` | `QNAP staging volumes use absolute /share/CACHEDEV1_DATA/ paths` | Rephrase to `NAS staging volumes use absolute paths` to remove platform-specific path |
| `docker-compose.prod.yml:2` | Comment: `QNAP deployment` | Could generalize to `NAS deployment` |
