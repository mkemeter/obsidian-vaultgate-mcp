---
type: project
status: active
customer: "[[Krustyco]]"
lead: "[[Milhouse Van Houten]]"
sprint: S35E09
tags: [project, active]
---

# Operation Big Top

## Objective

Replatform krusty.com — Krustyco's primary web presence — onto modern infrastructure. The current site runs on a hosting arrangement that predates the Krusty brand refresh and has not been maintained since the original developer "moved to Shelbyville." The goal is a reliable, performant site that Krusty can neglect in peace.

Project codename: **Big Top** — the circus tent, naturally.

## Status: Active #active

The project is progressing, with complications.

- [[Milhouse Van Houten]] owns the frontend rebuild. He is currently on his fourth PR submission for the main component. [[Comic Book Guy]] has rejected the previous three with an escalating series of "Worst. X. Ever." verdicts.
- [[Comic Book Guy]] owns the backend API layer. His work is technically complete and correct. He has been less helpful in moving Milhouse's work forward.
- [[Krustyco]] (contact: Krusty) has provided updated requirements twice this sprint. Current ask: "Can the homepage load animation be a little more… you know. Krusty." This is not a technical specification.

## Risks

- **PR velocity** — blocked on Comic Book Guy's review cycle. I've flagged this for the [[Sprint S35E09]] retrospective.
- **Requirement stability** — Krusty changes his mind between calls. The product brief is not final.
- **Security** — [[Bart Simpson]] found a session token vulnerability in staging during [[Sprint S35E08]] by exploiting it. He is now on probation. The vulnerability has been patched. A formal security review is part of the [[Sprint S35E09]] scope.

## Team

- **Lead / Frontend:** [[Milhouse Van Houten]]
- **Backend:** [[Comic Book Guy]]
- **QA:** [[Ned Flanders]]
- **Security (audit):** [[Bart Simpson]]

See also: [[Krustyco]], [[ADR-001 Why We Chose Node]], [[Sprint S35E09]].
