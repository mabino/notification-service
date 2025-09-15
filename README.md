# Notification Service

A Google Apps Script web endpoint that accepts authenticated POST requests and sends email notifications to a configured recipient. This repository supports JSON payloads, header-based token auth, per-source tokens in Script Properties, JSON responses, brute-force detection, and a test harness.

## Configuration

Set these Script Properties in the Apps Script project (Project Properties > Script properties):

- NOTIFICATION_RECIPIENT (required) — email address that receives notifications. If missing, the script will fall back to the script owner's email.
- NOTIFICATION_INTERVAL_SECONDS (optional, default 60) — cooldown per source in seconds.
- TOKEN_<source> (recommended) — store tokens individually as properties. For example: `TOKEN_source1 = abcd1234`.
- TOKEN_LIST (optional, legacy) — a comma-separated list of `source:token` pairs, used only if no `TOKEN_` properties exist.

## Brute-force & monitoring

- The script logs invalid token attempts and tracks them per source. If the count reaches a threshold (default 5 within an hour), it will send an alert email to `NOTIFICATION_RECIPIENT` and reset the counter.

## API: Inputs

Accepts either form-encoded POSTs or JSON bodies. Accepts a Bearer token in the `Authorization` header and `X-Notification-Token-Source` header for source override.

Parameters (form or JSON):

- token — secret token for the source (or use Authorization: Bearer ...)
- notification_token_source — source identifier (or X-Notification-Token-Source header)
- status — short status string used in subject
- notification_msg — message body (max 255 chars)

## Responses

All responses are JSON with the shape: `{ ok: boolean, message: string, ... }`.

## Examples

Form-encoded:

```bash
curl -X POST "https://script.google.com/macros/s/DEPLOYMENT_ID/exec" \
  -d "token=abcd1234" \
  -d "notification_token_source=source1" \
  -d "status=OK" \
  -d "notification_msg=Hello from source1"
```

JSON with Authorization header:

```bash
curl -X POST "https://script.google.com/macros/s/DEPLOYMENT_ID/exec" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer abcd1234" \
  -d '{"notification_token_source":"source1","status":"OK","notification_msg":"Hello JSON"}'
```

## Testing in Apps Script editor

This repo includes `test.gs` which provides lightweight functions to simulate POST events to `doPost(e)`. Run `test_form_success()`, `test_json_success()`, or `test_invalid_token_and_bruteforce()` from the Apps Script editor's Run menu. Tests will log results and send emails using `MailApp` when applicable.

## Deployment notes

- Deploy the script as a Web App and choose `Execute as: Me` to ensure `MailApp` sends to the intended recipient and `Session.getEffectiveUser()` matches expectations.
- Set access appropriately (e.g., `Anyone, even anonymous`) if external services must call it; tokens protect access.

## Security notes

- Tokens are stored in Script Properties. For stronger security consider Google Secret Manager or restricting access to callers by IP / VPN.
- Always use HTTPS (Apps Script web apps are HTTPS by default).

## Change log

- v2: Added JSON payload support, header auth, per-source TOKEN_ properties, JSON responses, brute-force detection & alerts, and tests.
