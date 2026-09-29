---
type: reference
status: active
tags: [tech-debt]
---

# Tech Debt

*Maintained by [[Lisafer]]. [[The Collector]] has never acknowledged this document exists.*

Ranked, worst first.

1. **[[The Stonecutters API]] — risk: unknown.** No owner. No docs. No monitoring. Commits signed "No. 1." It has never failed, which is somehow worse than if it had. [[Beelzebart]] found outside traffic in its logs. Lisafer's note: "Bart wrote the details. I left them in because they are accurate, which is concerning." *That is the risk.*

2. **Orphaned cloud instances.** The Senior Cloud Engineer provisions instances and forgets them. At least one is named `donut-backup-prod-FINAL-v3`. Nobody will decommission it because nobody knows what absorbed what.

3. **No disaster-recovery runbook for the production database.** We have a [[On-Call Runbook]] for everything except the one thing that would end us.

4. **[[Krustyco]] legacy frontend.** Still live. Still "more Krusty" than any spec allows.
