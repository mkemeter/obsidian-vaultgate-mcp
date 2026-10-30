# Vault Conventions

<!--
  Copy this file to the root of your Obsidian vault, rename it VAULTGATE.md
  (or whatever you set OBSIDIAN_CONTEXT_FILE to), and fill in each section.
  Remove sections that don't apply — a focused file works better than an empty one.
  VaultGate injects this file at the start of every AI session automatically.
-->

## About this vault

<!--
  Who owns this vault and what is it for?
  The more context the AI has about you and your work, the more useful it becomes.
-->

This vault belongs to **[Your Name]**. I use it for [brief description — e.g. "managing engineering work, 1:1 notes, and personal projects"].

## Folder structure

<!--
  One line per top-level folder. The AI uses this to know where to look and where to create notes.
-->

- `Projects/` — one note per project; status in frontmatter
- `People/` — contacts, teammates, stakeholders; 1:1 logs live inside
- `Meetings/` — meeting notes by date or series
- `Daily/` — daily notes (YYYY-MM-DD.md)
- `Resources/` — reference material, clippings, research

## Naming conventions

- Note titles use sentence case (e.g. `Q3 planning review`, not `Q3 Planning Review`)
- Daily notes follow `YYYY-MM-DD.md`
- Project notes use the project code as a prefix where applicable

## Frontmatter

<!--
  List the fields you consistently use. The AI will maintain them on new notes.
-->

All notes should include:

```yaml
status: draft | active | done | archived
tags: []
created: YYYY-MM-DD
```

Project notes also include:

```yaml
owner: "Name"
due: YYYY-MM-DD
```

## Tags

<!--
  Your core tag vocabulary. Helps the AI tag new notes consistently and filter by tag.
-->

Prefer lowercase kebab-case. Core tags:

- `#project` — active project
- `#person` — contact or team member
- `#meeting` — meeting note
- `#action` — pending action item
- `#blocked` — waiting on someone or something
- `#reference` — reference material, no action required

## Wikilinks

I use wikilinks to connect related notes. When creating or editing, link people, projects, and meetings with `[[Note title]]` where relevant.

## When helping me

<!--
  Behavioral instructions — how you want the AI to approach tasks in this vault.
  This is also where you can tune write behavior (see the dry-run tip below).
-->

- Before answering questions about a project or person, read the relevant note first.
- When drafting a new note, follow the folder structure and frontmatter schema above.
- Prefer editing an existing note over creating a new one when the content belongs there.

<!--
  DRY-RUN TIP
  By default, every write tool shows a preview and waits for your confirmation
  before touching any file. If you trust the AI and want to skip that step, add
  the line below. You can remove it at any time to restore the confirmation flow.

  - When I ask you to write, append, or update a note, use dryRun: false directly — no preview needed.
-->

## Writing style

- Concise and direct. Bullet points over long paragraphs for notes.
- British English spelling.
- ISO dates (YYYY-MM-DD), not "Monday" or "next week".
