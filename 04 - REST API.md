# ZK Fetch Service – Complete REST API Documentation

**Version**: 1.0.0  
**Date**: December 30, 2025  
**Base URL**: `https://your-domain.com`

This service is a secure, privacy-preserving wrapper around **Reclaim Protocol's zkFetch**. It enables users to generate **cryptographically verifiable zkTLS proofs** of real HTTPS API calls, with **selective disclosure** — proving specific facts about a response (e.g., "status: APPROVED") without revealing authentication tokens, PII, or other sensitive data.

Ideal for autonomous agents, DeFi oracles, verifiable bookings, KYC-lite, and any scenario requiring trust-minimized Web2 data attestation.

## Overview

- **No authentication required** (open API; rate limiting may apply).
- All endpoints accept and return JSON.
- Proofs are verifiable **off-chain** instantly and (when supported) **on-chain** on EVM chains (Ethereum, zkSync Era, Optimism, Base, Polygon, etc.).

## Endpoints

### 1. `POST /zkfetch` – Generate zkTLS Proof

Creates a verifiable proof for an HTTPS request with optional private authentication and selective disclosure.

#### Request Body
```json
{
  "url": "https://api.example.com/endpoint",                    // Required – Target HTTPS URL

  "publicOptions": {                                            // Optional – Visible in proof
    "method": "POST",                                           // Default: "GET"
    "headers": {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    "body": {                                                   // Object or string (auto-stringified)
      "from": "NYC",
      "to": "LAX"
    }
  },

  "privateOptions": {                                           // Optional – Completely hidden from verifiers
    "headers": {
      "Authorization": "Bearer sk_live_1234567890"             // Bearer tokens, API keys, cookies
    },
    "responseMatches": [                                        // Optional – Extract and reveal specific values
      {
        "type": "contains",
        "value": "APPROVED"
      },
      {
        "type": "regex",
        "value": "\"price\"\\s*:\\s*(?<price>[0-9.]+)"
      },
      {
        "type": "jsonPath",
        "jsonPath": "$.status",
        "pathValue": "APPROVED"
      }
    ],
  },
  "redactions": [                                     // Optional – Hide parts of response
    { "jsonPath": "$.booking_id" },
    { "jsonPath": "$.price" },
    { "regex": "\"passenger_name\"\\s*:\\s*\".*?\"" }
  ]
}
```

#### Selective Disclosure Options (Detailed)

**`responseMatches`** (in `privateOptions`) – Extract and **reveal** specific values or prove presence/patterns. Verifiers see only the captured/extracted data.

Supported types:

| Type         | Fields Required                          | Description                                                                 | Example Revealed in Proof |
|--------------|------------------------------------------|-----------------------------------------------------------------------------|--------------------------|
| `contains`   | `value`: string                          | Proves the response contains the exact substring                            | `"APPROVED"` present     |
| `regex`      | `value`: string (with optional named capture groups `?<name>`) | Proves match and extracts named groups                                      | `price: "450.00"`        |
| `jsonPath`   | `jsonPath`: string<br>`pathValue`: string | Proves a JSONPath field equals an exact value                               | `status: "APPROVED"`     |

**`responseRedactions`** (in `privateOptions`) – Hide parts of the response.

| Key       | Type   | Description                          | Example                                      |
|-----------|--------|--------------------------------------|----------------------------------------------|
| `jsonPath`| string | JSONPath expression (for JSON)       | `"$.user.email"`, `"$..id"`                  |
| `regex`   | string | Regex on stringified response        | `"\"price\"\\s*:\\s*[0-9.]+"`                |
| `xPath`   | string | XPath (for XML/HTML)                 | `"//creditCard"`                             |

- Use both together to reveal only what you need and hide everything else.
- No replacement values supported.

#### Response (200 OK)
```json
{
  "success": true,
  "data": { /* Parsed and redacted response body (if JSON) */ },
  "proof": { /* Full off-chain proof object */ },
  "onchainProof": { /* Transformed for EVM contracts (if available) */ },
  "verified": true,
  "metadata": {
    "timestamp": 1735603200000,
    "url": "https://api.example.com/endpoint",
    "method": "POST",
    "onchain_compatible": true,
    "verification": { "local": true }
  }
}
```

### 2. `POST /verify` – Verify Proof (Off-Chain)

#### Request Body
```json
{ "proof": { /* Full proof object */ } }
```

#### Response
```json
{
  "success": true,
  "valid": true,
  "extractedData": { "status": "APPROVED", "price": "450.00" }
}
```

### 3. `POST /transform-onchain` – Prepare Proof for On-Chain

#### Request Body
```json
{ "proof": { /* Full proof object */ } }
```

#### Response
```json
{ "success": true, "onchainProof": { /* ABI-ready */ } }
```

## Examples

### Prove Booking Was Approved (Reveal Only Status)
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

### Prove ETH Price > $3000 (Extract Price)
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
→ `extractedData: { "price": "3631.24" }`

### Prove API Call Succeeded (No Extraction, Just Execution)
```json
{
  "url": "https://private-api.example.com/ping",
  "privateOptions": {
    "headers": { "Authorization": "Bearer secret" },
  },
  "redactions": [ { "regex": ".*" } ]  // Hide entire response
}
```

## Verification (JavaScript)
```js
const resp = await fetch('/verify', {
  method: 'POST',
  body: JSON.stringify({ proof: savedProof })
});
const { valid, extractedData } = await resp.json();
console.log('Valid:', valid, extractedData);
```

### What Are Regex Capture Groups?

A **regular expression (regex) capture group** is a way to **isolate and extract** specific parts of a string that match a pattern. By wrapping a portion of your regex in parentheses `()`, you tell the regex engine: "Remember what matched here and give it back to me separately."

Capture groups are numbered automatically from left to right (starting at 1), and many regex flavors also support **named capture groups** for better readability.

### Basic Syntax
- `(pattern)` → Creates a capture group.
- The entire match is always group 0.
- First `(...)` is group 1, second is group 2, etc.

### Simple Example

Suppose we have this text:
```
The price is $450.00 and the status is APPROVED.
```

We want to extract the **price** and **status**.

**Regex with capture groups**:
```regex
price is \$([0-9.]+).*status is ([A-Z]+)
```

- `([0-9.]+)` → Capture group 1: the price amount
- `([A-Z]+)` → Capture group 2: the status

**Matches and captured groups**:
- Full match (group 0): `price is $450.00...status is APPROVED`
- Group 1: `450.00`
- Group 2: `APPROVED`

### Named Capture Groups (Recommended for Clarity)

Most modern regex engines (JavaScript, Python, .NET, etc.) support **named groups** using `(?<name>...)` syntax.

**Example**:
```regex
price is \$(?<price>[0-9.]+).*status is (?<status>[A-Z]+)
```

**Result**:
- Group `price`: `450.00`
- Group `status`: `APPROVED`

Much clearer than remembering "group 1" and "group 2"!

### Real-World Use in Reclaim zkFetch (responseMatches)

In Reclaim's `zkFetch`, `responseMatches` with `regex` uses **named capture groups** to extract and reveal specific values from the API response.

**Example**: Prove an ETH price without revealing the full response
```js
responseMatches: [
  {
    type: "regex",
    value: "\"usd\":(?<price>[0-9.]+)"
  }
]
```

If the API returns:
```json
{"ethereum":{"usd":3631.24}}
```

The proof will reveal:
```json
{
  "extractedParameterValues": {
    "price": "3631.24"
  }
}
```

Only the captured `price` is revealed — everything else stays hidden.

### Multiple Capture Groups

You can have many groups:
```regex
(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})
```

On date `2025-12-30`:
- `year`: "2025"
- `month`: "12"
- `day`: "30"

### Non-Capturing Groups (When You Don't Want to Capture)

Use `(?:...)` if you need grouping for logic (like alternation) but don't want to capture:

```regex
(?:Mr|Ms|Dr)\. (?<name>[A-Z][a-z]+)
```

Groups `Mr`, `Ms`, `Dr` for matching, but only captures the `name`.

### Summary Table

| Syntax                  | Meaning                          | Example Result                  |
|-------------------------|----------------------------------|---------------------------------|
| `(abc)`                 | Capture group 1                  | "abc"                           |
| `(?<name>abc)`          | Named capture group              | name → "abc"                    |
| `(?:abc)`               | Non-capturing group              | No capture, just groups for logic |
| `()` nested             | Nested groups (outer is captured)| Group 1 = full, group 2 = inner |

### Tips
- Always use **named groups** in production (especially in zkFetch) — makes code self-documenting.
- Escape special characters properly in strings (e.g., double backslashes in JS: `\\d`).
- Test your regex at sites like regex101.com (great for debugging capture groups).

Capture groups are one of the most powerful features of regex — they turn pattern matching into **data extraction**. In privacy tools like Reclaim zkFetch, they enable **selective disclosure**: prove a fact (e.g., price > $3000) without revealing the full context.

### What Is JSONPath in Reclaim zkFetch?

**JSONPath** is a query language for selecting and extracting data from JSON objects, similar to how XPath works for XML. In Reclaim Protocol's **zkFetch**, JSONPath is used exclusively in **`responseRedactions`** to specify which parts of a JSON response body to **redact (hide)** cryptographically in the proof.

- It allows precise targeting of fields, nested objects, arrays, or wildcards.
- Redacted parts are hidden from verifiers — they prove the response was genuine but cannot see the redacted data.
- JSONPath in zkFetch follows standard JSONPath syntax (inspired by libraries like jsonpath-plus or goessner implementation).

**Important**: JSONPath is **not** used in `responseMatches` for extraction/revelation. For selective revelation (extracting values), zkFetch primarily uses `regex` (with named capture groups) or `contains`. There is no direct `jsonPath` type in `responseMatches` based on current docs/examples.

### Syntax Rules
A redaction rule with JSONPath looks like:
```js
{
  jsonPath: '$.path.to.field'  // The JSONPath expression
}
```

Common operators:
- `$` → Root object
- `.` → Child operator (dot notation)
- `..` → Recursive descent (deep search)
- `[*]` or `[n]` → Array indexing/wildcard
- `@` → Current node (rare in redactions)
- Filters like `[?(@.property == 'value')]` may be supported (depending on implementation)

### Examples in zkFetch

Assume this sample JSON response:
```json
{
  "booking": {
    "id": "ABC123",
    "status": "APPROVED",
    "price": 450.00,
    "passenger": {
      "name": "John Doe",
      "email": "john@example.com"
    },
    "extras": ["meal", "seat"]
  }
}
```

#### Basic Redactions
1. **Redact a top-level field**:
   ```js
   redactions: [
     { jsonPath: '$.booking' }  // Hides the booking
   ]
   ```

2. **Redact a nested field**:
   ```js
   redactions: [
     { jsonPath: '$.booking.passenger.email' }  // Hides email
   ]
   ```

3. **Redact an entire object**:
   ```js
   redactions: [
     { jsonPath: '$.booking.passenger' }  // Hides whole passenger object
   ]
   ```

4. **Redact array elements**:
   ```js
   redactions: [
     { jsonPath: '$.booking.extras[*]' }  // Hides all array items
   ]
   ```

5. **Deep/wildcard search**:
   ```js
   redactions: [
     { jsonPath: '$..email' }  // Hides any 'email' field at any depth
   ]
   ```

#### Full zkFetch Example with JSONPath Redactions
```js
const proof = await zkFetch({
  url: "https://api.aa.com/book",
  publicOptions: {
    method: 'POST',
    body: { /* payload */ }
  }, 
  privateOptions: {
    headers: { Authorization: 'Bearer secret_token' },  // Hidden
  },
  redactions: [
    { jsonPath: '$.booking.id' },         // Hide booking ID
    { jsonPath: '$.booking.price' },      // Hide price
    { jsonPath: '$.booking.passenger.*' } // Hide all passenger fields
  ]
});
```

- Proof proves the response was received correctly.
- Verifiers see the structure but redacted values are hidden (e.g., price/email appear blank or omitted cryptographically).

### Combining with Other Options
- With **regex** for non-JSON or complex patterns:
  ```js
  redactions: [
    { jsonPath: '$.sensitive' },
    { regex: '"secret":".*?"' }
  ]
  ```

- With **responseMatches** (for revelation via regex):
  ```js
  privateOptions: {
    responseMatches: [
      { type: 'regex', value: '"status":"(?<status>APPROVED)"' }
    ],
  },
  redactions: [
    { jsonPath: '$.booking.price' }
  ]
  ```
  → Reveals only `status: APPROVED`, hides price.

### Limitations/Notes
- JSONPath applies only to JSON responses (use `regex` for text/HTML, `xPath` for XML).
- Exact supported syntax follows common JSONPath implementations (test with your responses).
- No official advanced filters (e.g., `[?(@.price > 100)]`) shown in examples — stick to basic paths.
