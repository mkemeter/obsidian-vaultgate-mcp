---
type: project
status: blocked
customer: "[[Duff Brewery]]"
lead: "[[Lisa Simpson]]"
sprint: S35E09
tags: [project, blocked]
---

# Project Fermentum

## Objective

Migrate Duff Brewery's brewing telemetry infrastructure from a legacy on-premises SQL Server (installed 2004, last patched 2011) to a cloud-based data platform. The migration will modernise data collection across Duff's brewing lines, enable real-time monitoring, and replace the manual CSV export process that currently feeds [[Duff Brewery]]'s operations reporting.

Project codename: **Fermentum** (Latin for fermentation). Internal only — Duffman refers to it as "the big migration thing."

## Status: Blocked #blocked

Two blockers are preventing go-live confirmation:

1. **Customer sign-off gap.** [[Duff Brewery]] (contact: Duffman) has not confirmed the go-live window. The launch party is already scheduled. The go-live date is not. Duffman has sent three escalation emails, each more emphatic than the last.

2. **Data-quality issue.** [[Lisa Simpson]] identified significant inconsistencies in Duff's source data during the pre-migration audit: duplicate brewing batch IDs, null timestamps, and an entire product line (Duff Raspberry, discontinued 2019) still generating telemetry records. Lisa has documented this in the migration readiness report. Until Duff Brewery acknowledges and resolves the upstream data issues, a clean cutover is not possible.

## Team

- **Lead:** [[Lisa Simpson]] — data architecture, migration strategy, readiness report
- **Infra:** [[Homer Simpson]] — cloud environment setup, pipeline configuration
- **QA:** [[Ned Flanders]] — migration validation testing

## Recent Update

I'm holding the go-live date pending Lisa's sign-off on data quality. Duffman does not fully understand why. The phrase "data-quality issue" has been explained twice. Duffman believes it can be resolved by trying harder.

Homer's cloud environment is ready. Lisa's checklist is not. These two facts do not sit comfortably together.

See also: [[Duff Brewery]], [[Sprint S35E09]], [[Exec Review - Burns Q4]].
