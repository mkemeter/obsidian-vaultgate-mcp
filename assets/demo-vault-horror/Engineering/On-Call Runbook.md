---
type: runbook
status: active
tags: [runbook]
---

# On-Call Runbook

*Authored by [[Lisafer]]. Please read this before your first on-call shift. [[Gelatinous Homer]], this means you.*

## Escalation Path

1. **First alert:** monitoring fires to the on-call engineer's pager.
2. **No response within 5 minutes:** escalate to [[Kang and Kodos]] at Rigellian Cloud Solutions. They are always reachable. Always. They do not sleep, or blink.
3. **Severity P1 (full outage):** notify Quinn Hopper immediately. Do not wait for root cause.

## Rule #1: No Friday Deploys After 15:00

Do not ship to production on a Friday after 15:00 without written approval from Quinn Hopper.

Added after [[Incident - The Great Blackout]]. There are no exceptions. "It'll be fine" is not an exception. "I just need to push one small change" is not an exception. "It is technically still Thursday on Rigel" is not an exception.

## Do-Not-Do

1. **Do not ship on Fridays after 15:00.** (Rule #1.)
2. **Do not leave food near the Senior Cloud Engineer during a deploy.**
3. **Do not open the sealed mylar bags in the backend area.** They are not yours.
4. **Do not touch [[The Stonecutters API]].** It has never failed. Do not be the one who changes that.
