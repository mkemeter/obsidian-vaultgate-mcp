---
type: adr
status: accepted
tags: [adr]
---

# ADR-001 Why We Chose Node.js

**Decision:** CGHMN's primary server-side runtime for new services is **Node.js**.

**Status:** Accepted. Operational across all active projects.

---

## Context

At the time of this decision, CGHMN was selecting a standard runtime for new service development. The team had prior experience across Python, Java, Ruby, and PHP. The choice needed to account for: frontend/backend skill overlap, available tooling, community support, and the strong preference of the engineering team's only senior backend developer for "not having to learn something new."

Three options were formally evaluated:

1. **Node.js** — JavaScript runtime, familiar to frontend engineers, strong ecosystem
2. **Python** — popular in data engineering, favoured by [[Lisa Simpson]] for analytics workloads
3. **Go** — [[Comic Book Guy]]'s informal counter-proposal, submitted as a 14-page manifesto titled "Why Everything Else Is Wrong"

## Decision

**Node.js.** Rationale:
- Shared language with frontend work reduces context-switching for [[Milhouse Van Houten]] and future frontend-leaning engineers
- Strong tooling for the API-heavy work CGHMN does (Express, Fastify)
- [[Lisa Simpson]] retains Python for data and analytics workloads; this is not in conflict
- The Go manifesto, while technically thorough, was 14 pages and [[Comic Book Guy]] declined to present it in under 45 minutes

[[Comic Book Guy]] dissented formally. His dissent, in full: *"Worst. Runtime. Ever."* He subsequently submitted a 3-page addendum. The addendum was reviewed. The decision was not changed.

## Consequences

- All new CGHMN services use Node.js. Existing services are migrated opportunistically.
- [[Comic Book Guy]] relitigates this decision approximately once per sprint, typically triggered by a dependency update or a [[Milhouse Van Houten]] PR.
- [[Lisa Simpson]]'s Python data pipelines are explicitly out of scope for this ADR.
- The Go manifesto is archived in the `docs/` folder. It has never been opened since.

## Open Questions

The Node.js runtime choice is revisited informally during every ADR review that [[Comic Book Guy]] attends. This is not a formal process. It is a recurring event.

[[Milhouse Van Houten]] has requested a formal ADR review meeting following his most recent PR rejection, in which [[Comic Book Guy]] cited the runtime choice as a contributing factor to "the fundamental brokenness of the entire approach." The review is on the [[Sprint S35E09]] action items.
