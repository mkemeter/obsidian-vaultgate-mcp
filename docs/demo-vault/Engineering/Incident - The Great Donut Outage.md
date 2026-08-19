---
type: incident
status: resolved
tags: [incident]
---

# Incident - The Great Donut Outage

## Summary

A configuration change deployed to production by [[Homer Simpson]] at 16:58 on a Friday caused a 43-minute outage affecting all CGHMN-hosted services. Service was restored by [[Apu Nahasapeemapetilon]] following escalation. Homer's on-call pager was unanswered for the first 11 minutes of the incident.

> [!WARNING]
> Never deploy on a Friday. Or when Homer is on-call.

## Timeline

| Time | Event |
|---|---|
| 16:58 | Homer deploys configuration change to production load balancer |
| 16:59 | Health checks begin failing across all hosted services |
| 17:00 | Automated alerts fire to on-call pager (Homer) |
| 17:11 | No response. Apu receives escalation alert per [[On-Call Runbook]] |
| 17:12 | Apu acknowledges, begins investigation |
| 17:31 | Root cause identified: misconfigured upstream timeout in load balancer config |
| 17:41 | Fix deployed, services restored |
| 17:43 | Homer responds to pager. "D'oh." |

## Root Cause

Homer applied a load balancer configuration update intended for the staging environment to the production environment. The configuration introduced an upstream timeout of 0ms, causing all requests to fail immediately. The staging and production config files had nearly identical names: `lb-config-staging-v4.yaml` and `lb-config-prod-v4.yaml`.

Contributing factor: the deployment was made at 16:58 on a Friday afternoon without change-window approval.

## Resolution

[[Apu Nahasapeemapetilon]] identified the misconfiguration, reverted the load balancer config to the last known-good state, and confirmed service restoration across all affected endpoints.

## Action Items

- [[Lisa Simpson]] added "No Friday deploys after 15:00 without explicit approval" to [[On-Call Runbook]] as rule #1 ✅
- Homer acknowledged on-call responsibilities in writing ✅
- Staging and production config files renamed with clearer disambiguation ✅
- Homer's cloud cost training: **still pending** (see [[Sprint S35E09]])

## Retrospective

Reviewed in [[Team Retro - The Outage]]. [[Ned Flanders]] called it "a diddly-learning experience." [[Comic Book Guy]] called it "Worst. Friday. Ever." Both were technically correct.

This was the third production incident caused by a Friday deployment. Apu noted this in the incident report appendix, with Homer's name, in the appendix.
