---
type: incident
status: resolved
tags: [incident]
---

# Incident - The Great Blackout

**Incident ID:** INC-S35E09-001
**Duration:** 43 minutes
**Severity:** P1 — full service outage

## Root Cause

A configuration change was applied to the production load balancer at **16:58 on a Friday**. The change set an upstream timeout of 0ms, so every inbound request failed immediately. The config was the one intended for staging (`lb-config-staging-v4.yaml`), not production (`lb-config-prod-v4.yaml`).

The change was made by the Senior Cloud Engineer, who had oozed partway into the config repository at the time and did not notice which file he was in.

## Response

Automated monitoring fired at 17:00 to the on-call pager. The pager went unanswered for **eleven minutes** — the engineer had "extended himself toward a snack." Escalation reached [[Kang and Kodos]] at 17:11. They acknowledged in one second, found the cause at 17:31, restored service at 17:41.

The Senior Cloud Engineer acknowledged his pager at 17:43.

> [!WARNING]
> This is the **third** production incident caused by a Friday change. See [[On-Call Runbook]]. [[Kang and Kodos]] noted the pattern — with a name — in the appendix. In Rigellian.
