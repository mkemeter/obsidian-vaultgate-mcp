---
type: runbook
status: active
tags: [runbook]
---

# On-Call Runbook

*Authored by [[Lisa Simpson]]. Last updated this sprint. Please read this before your first on-call shift. [[Homer Simpson]], this means you.*

## Escalation Path

1. **First alert:** Automated monitoring fires to on-call engineer's pager.
2. **No response within 5 minutes:** Escalate to [[Apu Nahasapeemapetilon]] at Kwik-E-Mart Cloud Solutions. Apu is always reachable. Always.
3. **Severity P1 (full outage):** Notify Quinn Hopper immediately. Do not wait for root cause.
4. **Customer impact confirmed:** Quinn notifies customer contact. Do not contact customers directly unless Quinn is unreachable and the SLA clock is critical.

## Rule #1: No Friday Deploys After 15:00

Do not deploy to production on a Friday after 15:00 local time without explicit written approval from Quinn Hopper.

This rule was added following [[Incident - The Great Donut Outage]]. It was the third production incident caused by a Friday deployment. It was the first one where the on-call engineer's pager went unanswered for eleven minutes because the engineer had "stepped away for a snack."

There are no exceptions to this rule. "It'll be fine" is not an exception. "I just need to push one small change" is not an exception. "It's technically still Thursday somewhere" is not an exception.

## Common Incidents

**Load balancer config mismatch**
- Symptoms: All health checks failing, HTTP 502/504 across services
- Check: Compare active lb-config against last-known-good in config repo
- Fix: Revert to previous config. Do not attempt to fix forward under incident conditions.

**Database connection pool exhaustion**
- Symptoms: Slow queries, timeout errors, services degrading over 5–10 minutes
- Check: Connection pool metrics in monitoring dashboard
- Fix: Restart connection pool manager. If recurring, escalate to [[Comic Book Guy]] for root cause.

**Staging environment down (non-critical)**
- If staging only: notify [[Milhouse Van Houten]] and wait. Do not page [[Apu Nahasapeemapetilon]] for staging.
- Exception: if staging down is blocking a production release window, notify Quinn Hopper.

## Do-Not-Do

1. **Do not deploy on Fridays after 15:00.** (Rule #1. See above. See also: [[Incident - The Great Donut Outage]].)
2. **Do not use `rm -rf` as a diagnostic step.** This came up in a review.
3. **Do not contact [[Springfield Mafia]] accounts directly during incidents.** Route through Quinn.
4. **Do not touch [[The Stonecutters API]].** It has never failed. Do not be the one who changes that.
