---
type: reference
status: active
tags: [tech-debt]
---

# Tech Debt

*Maintained by [[Lisa Simpson]]. Updated when something alarming is discovered. [[Comic Book Guy]] has never acknowledged this document exists.*

This is a living list of known technical debt at CGHMN. Items are ordered by risk, not by how long they've been here.

---

## 1. Springfield DMV Mainframe (Critical)

**What:** The [[Springfield DMV]] core transaction system — driver licences, vehicle registration, exam scheduling — runs on a mainframe installed in 1987. No documentation. No DR plan. No vendor support. The maintenance engineer who knew how it worked retired. Nobody hired a replacement.

**Risk:** Single point of failure for the DMV's entire operation. Any hardware failure is unrecoverable.

**Owner:** [[Operation Beehive]] — on hold because Patty and Selma won't engage.

**Lisa's note:** *"The risk is real. The obstacle is human. These are unfortunately not the same problem."*

---

## 2. The Stonecutters API (Unknown / Suspicious)

**What:** An internal authentication API with no documentation, no known owner, and a commit history signed "No. 1." Has been running without failure for an indeterminate period. See [[The Stonecutters API]] for full notes.

**Risk:** Unknown. That is the risk.

**Owner:** Unknown. [[Comic Book Guy]] refused to review it. [[Bart Simpson]] flagged unusual access patterns.

**Lisa's note:** *"I added this entry. [[Bart Simpson]] wrote the details. I left them in because they are accurate, which is concerning."*

---

## 3. Krusty.com Legacy Frontend ([[Operation Big Top]])

**What:** The existing krusty.com codebase is a patchwork of jQuery, inline styles, and event handlers bound to elements that no longer exist in the DOM. The original developer has not been reachable since "the Shelbyville incident."

**Risk:** Medium. Actively being replaced by [[Milhouse Van Houten]]. Risk is that [[Comic Book Guy]]'s PR rejections are slowing replacement below the pace of legacy system degradation.

**Owner:** [[Operation Big Top]].

---

## 4. Homer's Unnamed Instances

**What:** [[Homer Simpson]] has a habit of provisioning test instances under names like `donut-backup-prod-FINAL-v3` and then forgetting they exist. [[Operation Donut]] decommissioned 14 of these. There may be more.

**Risk:** Low-to-medium. Cost and security surface area.

**Owner:** Quinn Hopper — added Homer's instances to the quarterly audit cycle.

---

## 5. No DR Runbook for Production Database

**What:** CGHMN's production database has backups. It does not have a tested recovery procedure. "We have backups" and "we can restore from backups" are, as [[Lisa Simpson]] has noted in three separate documents, different things.

**Risk:** Medium. Not yet critical. Will become critical at the worst possible moment.

**Owner:** Unassigned. Added to [[Sprint S35E09]] backlog. Not yet scheduled.
