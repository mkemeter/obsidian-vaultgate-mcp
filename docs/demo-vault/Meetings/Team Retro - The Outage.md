---
type: meeting
meeting: retro
sprint: S35E08
attendees: ["Quinn Hopper", "[[Homer Simpson]]", "[[Lisa Simpson]]", "[[Ned Flanders]]", "[[Milhouse Van Houten]]", "[[Comic Book Guy]]", "[[Apu Nahasapeemapetilon]]"]
tags: [meeting]
---

# Team Retro - The Outage

*Retrospective following [[Incident - The Great Donut Outage]].*

## What Happened

[[Homer Simpson]] deployed a configuration change to the production environment at 16:58 on a Friday. The deployment caused a 43-minute outage affecting all CGHMN-hosted services. [[Apu Nahasapeemapetilon]] responded and restored service. [[Homer Simpson]]'s pager was unanswered for the first 11 minutes.

Full incident record: [[Incident - The Great Donut Outage]].

## What Went Well

- [[Apu Nahasapeemapetilon]] responded efficiently and had the service restored within 43 minutes.
- [[Lisa Simpson]]'s [[On-Call Runbook]] contained the correct escalation procedure, which Apu followed.
- [[Ned Flanders]]: "The important thing is we all came together as a team-diddly-team, and I for one am grateful for each and every one of you. As Ecclesiastes reminds us, 'there is a time for every purpose under heaven' — and this was the time to restore the load balancer. Praise be!"

## What to Improve

- **Do not deploy on Fridays.** This is now [[On-Call Runbook]] rule #1. Owner: everyone. Enforcement: me.
- On-call pager response must be under 5 minutes. [[Homer Simpson]] acknowledged this. He said he was "pretty sure it was still Thursday in Hawaii." This did not resolve the action item.
- Deployment change windows need explicit approval from me for any Friday after 15:00.

## Actions

| Action | Owner | Status |
|---|---|---|
| Add "No Friday deploys" as On-Call Runbook rule #1 | [[Lisa Simpson]] | Done |
| Homer to acknowledge on-call responsibilities in writing | Quinn Hopper | Done |
| Review pager escalation path with [[Apu Nahasapeemapetilon]] | Quinn Hopper | Done |
| Homer to complete cloud cost training | [[Homer Simpson]] | Carried to [[Sprint S35E09]] |

[[Comic Book Guy]]'s retro contribution: "Worst. Outage. Ever." He then noted, accurately, that the root cause was a Friday deploy and suggested a deployment freeze from Thursday evening. This was adopted in spirit as the On-Call Runbook rule.
