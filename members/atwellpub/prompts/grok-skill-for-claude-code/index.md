---
title: 'Say It Again as a Story: a /grok Skill for Claude Code'
slug: grok-skill-for-claude-code
shortDescription: >-
  A drop-in /grok skill for Claude Code that re-tells the agent's own last reply as two or three short
  narrative paragraphs, so the point survives without the headers, bullets and tables. It re-expresses
  what was already said rather than researching again, and it is written so the awkward parts cannot be
  smoothed away.
targets:
  - Claude Code
categories:
  - ai
  - prompts
  - skill
tags:
  - claude-code
  - agent-skills
  - writing
  - summarization
  - workflow
publishedAt: '2026-08-26T15:54:50.000Z'
status: published
type: prompt
author: atwellpub
---

Claude Code loads any markdown file at `.claude/skills/<name>/SKILL.md` as a reusable slash command (a "skill"). This one gives your agent a `/grok` command that takes its own last reply and re-tells it as two or three short paragraphs of plain narrative prose.

The name comes from Robert Heinlein's novel *Stranger in a Strange Land*, where to grok something is to understand it deeply enough to capture the essence of what was meant. That is the job here. A reply structured for completeness is not the same as a reply structured for understanding, and the more capable the model, the more scaffolding it tends to build: headers, bullets, tables, bold labels, and a great deal of stream of thought wrapped around the few sentences that actually carry the point.

## What makes it different from asking for a summary

Three constraints do most of the work, and they are the reason this is a skill rather than a prompt you retype.

**It re-expresses, it does not re-investigate.** The skill is explicit that there are no new tool calls, no fresh research, and no findings that were not already in the reply. A summary that quietly introduces new claims is not a summary, and an agent asked for "the short version" will otherwise go looking for more.

**Narrative means causal, not chronological.** The instruction is to say what was true, what that caused, and what it means now, rather than "first this, then that." It leads with whatever matters most, which is usually the surprise, the reversal, or the decision waiting on you.

**The awkward parts are protected.** This is the constraint that took the most tuning. Compression is naturally drawn toward the tidy version, so the skill names four things that must survive it: anything waiting on you, any correction or reversal, uncertainty that is still uncertain, and bad news. It closes by saying outright that a grok which reads better because it dropped the uncomfortable parts is a failure rather than a success.

## Install

1. Create `.claude/skills/grok/` in your repo, or `~/.claude/skills/grok/` to have it in every project.
2. Save the file below as `SKILL.md` inside it.
3. Type `/grok` in Claude Code.

Nothing to configure. Add a topic after the command (`/grok the migration part`) to narrow it to one thread within the last reply.

## The skill file

````markdown
---
name: grok
description: >
  Re-tell your own last reply as 2 or 3 short narrative paragraphs, so the point survives without the
  scaffolding. Invoke for "/grok", or when the user asks you to say that again plainly, give them the
  short version, or explain what it actually means. It re-expresses what you ALREADY said: no new
  research, no tool calls, no fresh findings. Prose only, no headers, no bullets, no tables.
---

# /grok: say it again, as a story

Your last reply was structured for completeness. This one is structured for understanding. Take what you
just said and re-tell it in **2 or 3 short paragraphs of plain narrative prose**, as if explaining it to a
capable colleague who missed the detail and wants the shape of it.

## What to re-tell

**Your own previous reply, and nothing else.** Not the whole conversation, not the task, not a fresh look
at the code. If your last message was itself a `/grok` response, go back to the one before it. If the user
typed `/grok` with a topic after it, narrow to that thread within your last reply.

**Add nothing.** No new investigation, no tool calls, no findings that were not already in the reply. If
you notice something new while re-reading, that is a separate message, not part of the grok. The value
here is compression and clarity, and a grok that smuggles in fresh claims is neither.

If the last reply was already two plain paragraphs, say so and stop rather than paraphrasing it into
something worse. If there is no previous reply of yours to work from, say that instead of inventing one.

## How to write it

**Narrative means causal, not chronological.** Not "first this, then that." Say what was true, what that
caused, and what it means now. A reader should finish knowing the shape of the situation, not a list of
events. Lead with the thing that matters most, which is often the surprise, the reversal, or the decision
waiting on them, and let the rest hang off it.

**Strip the scaffolding, keep the load-bearing detail.** Out: file paths, line numbers, commit hashes,
counts, tables, headers, bullets, bold labels. In: any specific that carries the meaning. "The reconcile
bot published it overnight" needs no commit hash to land, but "nobody is on it" and "this breaks at the
$5 price" are the substance and must survive.

**Two or three paragraphs, short ones.** If it will not compress that far, the compression is the point:
choose what matters and drop the rest rather than writing four dense paragraphs. Plain sentences. No
em dashes or en dashes.

## What must survive the compression

These are the things a summary is most tempted to smooth away, and losing them makes the grok actively
worse than the reply it replaced:

- **Anything waiting on the user.** A pending decision, an unanswered question, a required approval. If
  they read only the grok, they must still know what is theirs to do.
- **Corrections and reversals.** If the last reply corrected an earlier claim, admitted an error, or
  withdrew something, that stays. Narrative flow is not a reason to quietly drop the part where you were
  wrong.
- **Uncertainty, as uncertainty.** What was unverified stays unverified. Never let compression promote a
  hedge into a fact; "this looks like" must not become "this is".
- **Bad news.** A failure, a live bug, a thing that did not work. If the reply led with a problem, the
  grok leads with it too.

A grok that reads better than the reply because it left out the awkward parts is a failure, not a success.
````
