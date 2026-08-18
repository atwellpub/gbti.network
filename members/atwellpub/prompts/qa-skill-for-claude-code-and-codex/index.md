---
title: 'Resolve Open Questions: a /qa Skill for Claude Code'
slug: qa-skill-for-claude-code-and-codex
shortDescription: >-
  A drop-in `/qa` skill for Claude Code that collects the questions your agent just raised and asks
  them in a single batch, in plan mode, before any code is written. By default, it reviews only the
  last reply to keep usage low; `/qa deep` runs the full six-category review when needed.
targets:
  - Claude Code
categories:
  - ai
  - prompts
  - skill
tags:
  - claude-code
  - agent-skills
  - planning
  - workflow
publishedAt: '2026-07-30T19:37:31.690Z'
updatedAt: '2026-08-18T20:14:48.398Z'
status: published
visibility: members
publicStub: true
type: prompt
author: atwellpub
encryptedBody: members/atwellpub/_enc/prompt-qa-skill-for-claude-code-and-codex-body.enc
---

Claude Code loads any markdown file at `.claude/skills/<name>/SKILL.md` as a reusable slash command (a "skill"). This one gives your agent a `/qa` command that stops before it builds, pulls every unresolved decision into a single batch of questions, and refuses to write code until you have answered them.

It exists because open questions have a habit of surfacing at the wrong end of the work. A sprint finishes, and only then does the agent raise the decisions it should have raised at the start, at exactly the point where acting on them means redoing something.

The mechanism is plan mode, invoked deliberately. The agent puts ITSELF into a read-only state, does its research there, asks everything it found as a form you click through, and only then acts. That ordering is the whole feature.

## Install

1. Create `.claude/skills/qa/` in your repo, or `~/.claude/skills/qa/` to have it in every project.
2. Save the file below as `SKILL.md` inside it.
3. Type `/qa` in Claude Code.

Nothing to configure. The skill reads your project, not a config file.
