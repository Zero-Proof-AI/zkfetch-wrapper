# ZK Fetch Service - REST API Documentation

## Scope
This document describes the REST API exposed by the zkfetch-wrapper service in this repository.

It is based on current implementation behavior in index.js and current test flows (2026-07-21 snapshots).

## Service Modes
The service can run in two modes:

- Production mode: RECLAIM_APP_ID and RECLAIM_APP_SECRET configured.
- Mock mode: credentials missing; service returns mock proof structures.

Default local port: 8003.

## Base URL

- Local development: http://localhost:8003
- Deployed: your service domain and port

## Endpoint Summary

| Method | Path | Purpose |
|---|---|---|
| GET | /health | Service health and mode |
| POST | /zkfetch | Generate proof bundle from remote HTTPS request |
| POST | /verify | Verify proof signatures/claim consistency |
| POST | /transform-onchain | Convert proof to contract-facing format |

## 1) GET /health

Returns service status and runtime mode.

### Response (example)

```json
{
  "status": "ok",
  "service": "zkfetch-wrapper",
  "reclaim_configured": true,
  "mode": "production"
}
```

## 2) POST /zkfetch

Generates a proof bundle for a target HTTPS call.

### Request Body

```json
{
  "url": "https://api.example.com/endpoint",
  "publicOptions": {
    "method": "GET",
    "headers": {
      "accept": "application/json"
    },
    "body": "optional request body"
  },
  "privateOptions": {
    "headers": {
      "Authorization": "Bearer secret"
    },
    "responseMatches": [
      {
        "type": "contains",
        "value": "APPROVED"
      },
      {
        "type": "regex",
        "value": "\"price\":\\s*(?<price>[0-9.]+)"
      }
    ]
  },
  "redactions": [
    { "jsonPath": "$.booking.id" },
    { "regex": "\"email\":\".*?\"" }
  ]
}
```

### Field Notes

- url: required.
- publicOptions: disclosed request parameters.
- privateOptions: private matching/auth context.
- redactions: wrapper-level convenience input; converted internally into privateOptions.responseRedactions.
- useTee: supported through publicOptions or USE_TEE environment setting.

### Response (success shape)

```json
{
  "success": true,
  "data": {},
  "proof": {},
  "onchainProof": {},
  "verified": true,
  "metadata": {
    "timestamp": 1784671496720,
    "url": "https://httpbin.org/get",
    "method": "GET",
    "onchain_compatible": true,
    "verification": {
      "local": true,
      "timestamp": "2026-07-21T...Z"
    }
  }
}
```

### Real Snapshot A (from test artifacts)

Request pattern from tests/test-httpbin-origin.js:

```json
{
  "url": "https://httpbin.org/get",
  "publicOptions": {
    "method": "GET",
    "headers": {
      "accept": "application/json"
    }
  },
  "privateOptions": {
    "responseMatches": [
      { "type": "contains", "value": "\"origin\"" },
      { "type": "regex", "value": "\"origin\":\\s*\"(?<origin>[^\"]+)\"" }
    ]
  }
}
```

Observed proof excerpt from proof-structure.json:

```json
{
  "claimData": {
    "provider": "http",
    "owner": "0x6202d6e4b1c98f4e7e22d7b969dec142aa282ec6",
    "timestampS": 1784671457,
    "identifier": "0xfd847f3bbdf497d5616c2d7f8124dfa27a441ff25accade97a01db3fe657891b",
    "epoch": 1
  },
  "extractedParameterValues": {
    "origin": "65.1.230.217"
  },
  "witnesses": [
    {
      "id": "0x244897572368eadf65bfbc5aec98d8e5443a9072",
      "url": "wss://attestor.reclaimprotocol.org:444/ws"
    }
  ]
}
```

### Real Snapshot B (redaction flow)

Request pattern from tests/test-selective-disclosure.js:

```json
{
  "url": "https://httpbin.org/json",
  "publicOptions": {
    "method": "GET"
  },
  "privateOptions": {
    "responseMatches": [
      {
        "type": "contains",
        "value": "\"title\": \"Overview\""
      }
    ]
  },
  "redactions": [
    {
      "jsonPath": "$.slideshow.slides"
    }
  ]
}
```

Observed proof excerpt from generated_proof.json:

```json
{
  "claimData": {
    "provider": "http",
    "parameters": "{\"body\":\"\",\"method\":\"GET\",\"responseMatches\":[{\"type\":\"contains\",\"value\":\"\\\"title\\\": \\\"Overview\\\"\"}],\"responseRedactions\":[{\"jsonPath\":\"$.slideshow.slides\"}],\"url\":\"https://httpbin.org/json\"}",
    "identifier": "0x0c17450a6d60d66050971c7d370dbaf43396f16a3b6df58c8f6a7ef81ce1f016",
    "epoch": 1
  },
  "witnesses": [
    {
      "id": "0x244897572368eadf65bfbc5aec98d8e5443a9072"
    }
  ]
}
```

## 3) POST /verify

Verifies a provided proof object.

### Request Body

```json
{
  "proof": {}
}
```

### Response (example)

```json
{
  "success": true,
  "valid": true,
  "extractedData": {
    "origin": "65.1.230.217"
  }
}
```

If valid is false, extractedData is null.

## 4) POST /transform-onchain

Converts a proof into contract-facing fields.

### Request Body

```json
{
  "proof": {}
}
```

### Response

```json
{
  "success": true,
  "onchainProof": {
    "claimInfo": {},
    "signedClaim": {}
  }
}
```

## Error Responses

Typical API error shape:

```json
{
  "success": false,
  "error": "Error message"
}
```

Examples:

- Missing required url in /zkfetch
- Missing required proof in /verify, /transform-onchain
- Upstream sdk/network failures

## Selective Disclosure Notes

### responseMatches

Used to prove or extract values from response content.

Supported patterns:

| Type | Fields Required | Description | Example Revealed |
|---|---|---|---|
| contains | value | Proves response contains exact substring | APPROVED present |
| regex | value (supports named capture groups) | Proves pattern match and extracts captured values | price: 450.00 |
| jsonPath | jsonPath and pathValue | Proves JSONPath value equality (when supported by provider/SDK path) | status: APPROVED |

Note: exact `responseMatches` operator support can vary by SDK/provider version; validate patterns against your deployed stack.

### redactions and responseRedactions

- redactions in API request are mapped to responseRedactions internally.
- Supported selectors commonly used: jsonPath, regex, xPath.
- Use responseMatches together with redactions to reveal only required facts.

Supported redaction selector styles:

| Key | Type | Description | Example |
|---|---|---|---|
| jsonPath | string | JSONPath expression for JSON responses | $.user.email, $..id |
| regex | string | Regex on stringified response | "\"price\"\\s*:\\s*[0-9.]+" |
| xPath | string | XPath for XML or HTML payloads | //creditCard |

## API Usage Examples

### Prove Booking Was Approved (Reveal Status Only)

```json
{
  "url": "https://api.aa.com/book",
  "publicOptions": {
    "method": "POST",
    "body": { "origin": "NYC", "destination": "LAX" }
  },
  "privateOptions": {
    "headers": { "Authorization": "Bearer temp_abc123" },
    "responseMatches": [
      { "type": "contains", "value": "APPROVED" },
      { "type": "regex", "value": "\"status\"\\s*:\\s*\"(?<status>APPROVED)\"" }
    ]
  },
  "redactions": [
    { "jsonPath": "$.booking_id" },
    { "jsonPath": "$.price" },
    { "jsonPath": "$.passenger" }
  ]
}
```

### Prove Price Extraction via Regex

```json
{
  "url": "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
  "privateOptions": {
    "responseMatches": [
      { "type": "regex", "value": "\"usd\":(?<price>[0-9.]+)" }
    ]
  }
}
```

Expected extractedData shape:

```json
{ "price": "3631.24" }
```

### Prove Call Succeeded Without Revealing Payload

```json
{
  "url": "https://private-api.example.com/ping",
  "privateOptions": {
    "headers": { "Authorization": "Bearer secret" }
  },
  "redactions": [
    { "regex": ".*" }
  ]
}
```

## Verification (JavaScript)

```javascript
const resp = await fetch('http://localhost:8003/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ proof: savedProof })
});

const { valid, extractedData } = await resp.json();
console.log('Valid:', valid, extractedData);
```

## Regex Capture Groups (Detailed)

Capture groups isolate values from matched text.

- (pattern): numbered capture group
- (?<name>pattern): named capture group
- (?:pattern): non-capturing group

Example text:

```text
The price is $450.00 and the status is APPROVED.
```

Regex with named groups:

```regex
price is \$(?<price>[0-9.]+).*status is (?<status>[A-Z]+)
```

Extracted values:

- price: 450.00
- status: APPROVED

Repository-style extraction example:

```regex
"origin":\s*"(?<origin>[^"]+)"
```

If matched, extractedParameterValues includes origin.

## JSONPath Redactions (Detailed)

JSONPath selects fields to hide while preserving verifiable response structure.

Basic form:

```json
{ "jsonPath": "$.path.to.field" }
```

Common operators:

- $ root
- . child
- .. recursive descent
- [*] wildcard array items

Examples:

- Hide nested field: { "jsonPath": "$.booking.passenger.email" }
- Hide full object: { "jsonPath": "$.booking.passenger" }
- Hide all array items: { "jsonPath": "$.booking.extras[*]" }
- Hide all emails anywhere: { "jsonPath": "$..email" }

Use jsonPath redactions with responseMatches to reveal only the specific facts required by your verifier.

## cURL Examples

Generate proof:

```bash
curl -sS -X POST http://localhost:8003/zkfetch \
  -H 'content-type: application/json' \
  -d '{
    "url":"https://httpbin.org/get",
    "publicOptions":{"method":"GET","headers":{"accept":"application/json"}},
    "privateOptions":{"responseMatches":[{"type":"regex","value":"\"origin\":\\s*\"(?<origin>[^\"]+)\""}]}
  }'
```

Verify proof:

```bash
curl -sS -X POST http://localhost:8003/verify \
  -H 'content-type: application/json' \
  -d '{"proof":{}}'
```

Health:

```bash
curl -sS http://localhost:8003/health
```

## Operational Caveats

- Ensure service is running from this repo path so .env is loaded correctly.
- Keep @reclaimprotocol/zk-fetch and @reclaimprotocol/js-sdk versions aligned.
- Restart the service after dependency upgrades.
- If behavior looks stale, check for older process still bound to port 8003.
