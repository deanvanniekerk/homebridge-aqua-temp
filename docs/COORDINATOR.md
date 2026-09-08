# Coordinator implementation status

The coordinator implements the polling, freshness and ordered-command mechanisms in issue #6. It owns one account loop, a 30-second cycle budget, 60-second default completion-to-next-start interval (30–300 seconds permitted), and a three-interval reading freshness boundary. An injected scheduler makes these deadlines testable without wall-clock waits.

The gateway is a typed boundary for discovery and validated device readings. A successful online sample replaces a device's state. Transient failures preserve its last valid sample until the freshness boundary; the failure category is retained separately. Offline, authentication, permission and invalid-protocol failures have distinct states. Device failures are isolated. Discovery omissions and partial results do not remove devices; previously discovered identities continue to be read. Cloud retry timing can postpone the next poll without extending reading freshness.

`snapshot` returns immutable current device views with discovery completeness, account failure category and retry timing. Account failures remain visible even when no devices have been discovered. Partial-discovery retry delays are retained without automatically invalidating a readable device.

`updates` exposes these snapshots as a cancellable async stream for the adapter. Slow consumers receive the latest state instead of accumulating an event backlog. At most eight subscriptions are admitted. An optional AbortSignal cancels one consumer; coordinator shutdown ends all streams and removes their abort listeners, including consumers paused at a yield. Consumer code runs outside the polling call stack and owns its own error handling.

One additional timer tracks the next freshness expiry. It emits a state update at the three-interval deadline even when account backoff postpones polling; it never starts network traffic. Polling, command results, failures and recovery also wake consumers. Shutdown cancels both scheduled poll and freshness timers.

The real `AquaTempGateway` now connects the cloud client to normalization. It shares the client's authentication while requesting owned/shared discovery concurrently, retains valid sources if another is malformed, and reads telemetry only after a validated online status for a known profile. Gateway shutdown closes the client, including a login still running after its read waiters have been cancelled.

Shared pagination requests 100 records per page, stops on a short page, and caps itself at 100 pages. A repeated full page with no new stable identities, a later-page failure, rejected records, or exhaustion marks discovery partial with a sanitized error. The final combined input is limited to 10,000 records. Only the owner's one-device first page has been observed; multi-page traversal and end-of-list behavior are engineering assumptions tested with synthetic responses, not a claim of additional vendor observations. No pagination metadata is invented. Account authentication/permission denial fails discovery because the cloud client has paused account traffic.

Closing cancels both the scheduled poll and in-flight cycle, and refuses restart. Results received after cancellation/timeout cannot install identities or replace readings. The bounded scheduler helper settles the coordinator's wait even if a test gateway ignores cancellation. Real gateway implementations must honor AbortSignal to stop their underlying work; a promise timeout alone cannot stop a non-cooperative external service.

## Command handling

`command` accepts an immutable snapshot of an absolute target-temperature or Off/Heat request. Before admission and again at dispatch, it requires fresh, healthy state and calls the gateway's local command validator. That validator must establish the profile, absolute command semantics, writable bounds/step and authoritative readback mapping. The real gateway implements the limited Heat contract in DEVICE_MODEL.md; synthetic gateway tests additionally isolate queue behavior.

Each device admits at most four commands, including the active command. Excess requests fail as busy. Commands execute serially per device; another device can proceed independently. Every request has an eight-second deadline starting at queue admission, including time waiting, authentication, dispatch and readback. Failure of an active request cancels its remaining queued requests; none are stored or replayed after an outage or restart. If the underlying gateway ignores cancellation, its dispatch lock remains held until that operation settles: polling can recover readings, but new commands fail as busy instead of racing a late write.

The provisional confirmation mechanism performs one read after transport acceptance within the same deadline. Success requires the normalized reported target to match, or confirmed power Off / power On with representable Heat mode. A mismatch returns an explicit unconfirmed result and retains the actual reading. This is not proof of compressor actuation. The real gateway checks the supported profile before each dispatch. One successful read does not resolve vendor settling behavior; a mismatch remains an explicit error even if the setting later converges.

Polls carry per-device revisions. Reads and failures from before a command, or while a command is active, cannot replace a newer command result. Retry-After remains an account-wide timing constraint even when the poll's device-state result is obsolete. Command completion requests a fresh account poll without overlapping an existing cycle or bypassing Retry-After. If an operation finishes after cancellation, it invalidates polls started before that late completion and requests read-only reconciliation; it cannot complete the expired setter, publish its late readback, or repeat the write. Later app changes are adopted through ordinary polling.

## Integration boundaries

- Supported controls use the bounded profile in issue #5 and the Homebridge integration in issue #7. Unverified modes and ambiguous operating activity remain unavailable; later vendor evidence may require confirmation-policy changes.
- Multi-page discovery remains an engineering assumption until an account with multiple pages is available for observation.
- The Homebridge adapter and runtime diagnostics consume the state stream in the subsequent issue #7 and #8 delivery changes.
- Control-path integration and fault validation are recorded in issue #9 and VALIDATION.md.

Command completion policy depends on the evidence gates in [DEVICE_MODEL.md](DEVICE_MODEL.md). Completion of the coordinator mechanism does not establish physical actuation or remove those gates; its polling and synthetic command tests prove only the behavior at the injected gateway boundary.
