---
title: 'Resolve Open Questions: a /qa Skill for Claude Code'
slug: qa-skill-for-claude-code-and-codex
shortDescription: >-
  A drop-in /qa skill for Claude Code that turns the questions your agent just raised into one
  batch, asked in plan mode before any code is written. The default reads only the last reply, so it
  stays cheap; /qa deep runs the full six-category sweep when you want it.
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
updatedAt: '2026-07-30T21:47:30.813Z'
status: published
type: prompt
author: atwellpub
---

Claude Code loads any markdown file at `.claude/skills/<name>/SKILL.md` as a reusable slash command (a "skill"). This one gives your agent a `/qa` command that stops before it builds, pulls every unresolved decision into a single batch of questions, and refuses to write code until you have answered them.

It exists because open questions have a habit of surfacing at the wrong end of the work. A sprint finishes, and only then does the agent raise the decisions it should have raised at the start, at exactly the point where acting on them means redoing something.

The mechanism is plan mode, invoked deliberately. The agent puts ITSELF into a read-only state, does its research there, asks everything it found in one batch, and only then acts. That ordering is the whole feature.

## Install

1. Create `.claude/skills/qa/` in your repo, or `~/.claude/skills/qa/` to have it in every project.
2. Save the file below as `SKILL.md` inside it.
3. Type `/qa` in Claude Code.

Nothing to configure. The skill reads your project, not a config file.

## The skill file

````markdown
---
name: qa
description: >
  Resolve the open questions before the work proceeds. Invoke for "/qa", "/qa continue", "/qa proceed",
  "/qa deep", "/qa <topic>", or when the user asks you to ask your questions first, clarify before
  building, or answer the things you just raised. By default it interrogates only YOUR OWN LAST REPLY:
  the questions, options and flagged decisions already sitting in it. "/qa deep" runs the full
  six-category sweep instead. Every mode enters plan mode; "continue" and "proceed" skip the plan
  approval and build straight from the answers.
---

# /qa: resolve the open questions before building

The point of this command is to move every decision that is the user's call OUT of your head and
into one batch of questions, answered before any code is written. No silent defaults, no drip of
ad-hoc questions later.

The common case is small and cheap: a reply just ended with open questions in it, and the user wants
those answered properly instead of letting them evaporate. That is the default. The exhaustive sweep
is a separate, deliberate mode, because it costs real tokens and most invocations do not need it.

## Read the argument first, it selects the mode

`continue`, `proceed` and `deep` are reserved words. Anything else is a topic.

| Invocation | Mode |
|---|---|
| `/qa` | **Ask and hold, last reply.** Enter plan mode (`EnterPlanMode`), interrogate your own last reply, ask what it left open, then present a plan for approval (`ExitPlanMode`). Write nothing until approved. |
| `/qa continue` or `/qa proceed` | **Ask and go.** Identical, minus the confirmation before acting: once the answers land you build straight from them, with no plan written for review. |
| `/qa deep` | **Full sweep.** Step 2's six categories instead of the last-reply scope. Use when starting real work, not when closing out a reply. |
| `/qa deep continue` or `/qa deep proceed` | Full sweep, no approval round. Scope and approval are independent. |
| `/qa <anything else>` | **Scoped.** The trailing text names the subject to interrogate. Add `continue` or `proceed` to drop the approval round for it. |

Every mode enters plan mode and holds its read-only discipline until the questions are answered. The
question-asking discipline in step 3 is identical in all of them; only the SCOPE and the approval
round change.

## Step 1: verify before you ask

Never ask what the repository can answer. Check the claims your questions rest on before putting them
to the user, so every question is one that genuinely cannot be resolved without them. A question the
code already answers is noise, and it teaches the user that /qa wastes their time.

In the default mode this is targeted, not a survey: confirm the specific facts behind the items your
last reply raised. A flagged failure may already have its reason recorded somewhere; an offered option
may turn out to be impossible or already done. Verifying first routinely dissolves a question or
changes what it should have been.

## Step 2: what to interrogate

**Default: your own last reply.** Re-read the reply you just gave and pull out everything you left
open: questions you asked, options you offered, decisions you named as the user's, caveats you
attached, and anything you said you COULD do next. That set is the batch. Do not sweep the codebase.

If the last reply left nothing open, say so plainly and stop. Do not go hunting for work to justify
the invocation.

**Deep (`/qa deep`): the full sweep.** Cover all of these, not just the obvious one:

1. **The request itself.** Scope boundaries, what is deliberately excluded, naming, placement.
2. **The governing doc.** If the work traces to a planning document (a scope of work, a ticket, a
   spec), its open-questions section is the primary source. Pull those forward verbatim.
3. **What the audit surfaced.** Which existing pattern to reuse, where a shared helper lives,
   whether to extend a surface or add one.
4. **Anything you were about to default silently.** If you caught yourself picking, it is a
   question. This is the highest-yield category.
5. **The user's call by nature.** Product and UX behavior, copy, data-shape changes, anything
   irreversible or outward-facing, and anything that costs money or needs provisioning.
6. **Conflicts.** Where the request contradicts an existing convention, the code, or an earlier
   decision, surface the conflict rather than quietly picking a side.

## Step 3: how to ask

- **One batch, numbered, in prose.** Free-form conversational questions, not multiple-choice
  pickers, unless a question is a genuine either/or.
- **Give each question a recommendation.** State the option you would take and why, so the user can
  answer "your call" on any of them and you are still unblocked.
- **Give each question its stakes in one line.** What changes depending on the answer. A question
  whose answer changes nothing should not be asked.
- **Order by consequence**, most structural first.
- **Say so when there are none.** If verification resolved everything, report that plainly and state
  the assumptions you are proceeding under. Do not manufacture questions to justify the command.

## Step 4: after the answers

- **Do not re-ask.** Answered means settled; carry it forward without relitigating.
- **Record the resolutions where they belong.** If a planning doc raised the question, write the
  answer back into it so it reads as resolved, not still open.
- In ask-and-hold mode, present the plan for approval. In continue/proceed mode, leave plan mode as
  soon as the answers land and build, without composing a plan for review. The harness still
  surfaces a single prompt on the way out of plan mode; that is a formality, not a review round, so
  keep what you write there to a line or two.
- If something genuinely new surfaces mid-build, finish everything that does not depend on it, then
  raise the one question at the right moment.

## Reminders

- Follow the project's own plan-mode and writing conventions throughout.
- The command is about decisions, not permission. Do not turn it into a request to confirm work the
  user already asked for.
````

## The modes

The argument controls two independent things: how wide the agent looks, and whether a plan gets approved before it acts.

- **`/qa`** is the default, and it is deliberately narrow: the agent interrogates its own last reply. Whatever it just left open becomes the batch. This is the everyday case, and it costs almost nothing because there is no sweep.
- **`/qa continue`** or **`/qa proceed`** is the same, minus the approval round. You answer, it builds. Still plan mode, so nothing gets written while the questions are open.
- **`/qa deep`** widens the scope to the full six-category sweep in the skill file: the request, the governing doc, the audit findings, silent defaults, the decisions that are inherently yours, and conflicts with existing conventions. Use it when you are starting real work, not when you are closing out a reply.
- **`/qa <anything else>`** scopes to a subject. `"/qa the rate limiter"` asks everything unresolved about the rate limiter specifically.

Scope and approval compose, so `/qa deep continue` runs the wide sweep and then builds from your answers without a plan to approve.

The narrow default is the important design choice. An exhaustive sweep on every invocation is expensive and mostly wasted, because the usual reason you type `/qa` is that the agent just handed you a list of open questions and you want them asked properly rather than left to evaporate.

## Making it yours

**Tune the deep sweep.** Step 2 lists six places to look under `/qa deep`. The list is deliberately generic, so add the categories your projects actually produce. A team with a design system adds "which token or component does this reuse". A team with a data model adds "does this change a stored shape, and what happens to existing rows". A regulated project adds an approvals category. The sweep is only as good as its list, and it only runs when you ask for it.

**Point it at your planning docs.** The highest-yield item in the sweep is a governing document with an open-questions section, since those questions are already written and already yours to answer. If your project keeps scopes of work, tickets or design docs, name that location explicitly in step 2 so the agent reads it every time.

**Decide how hard the hold is.** As written, bare `/qa` will not touch a file until you approve a plan. If that is heavier than you want for routine work, make `continue` the implied default in your copy and reserve the plan-approval round for large changes.

**Decide what "last reply" means to you.** The default reads the agent's most recent message and treats everything it left open as the batch. If your sessions tend to sprawl across several exchanges before you reach for `/qa`, widen that to the current thread of work, or just type `/qa deep` when the narrow read would miss something.

## Why the odd details are in there

Three rules in the file look like padding and are not. Each one is a failure mode that shows up the moment you make an agent ask questions.

**"Never ask what the repository can answer."** The first thing an unconstrained question-asking agent does is ask you things that are written in the code. Where does this live, what is this called, does this exist. It feels thorough and it is worthless, and after two rounds of it you stop using the command. The audit-first rule forces the agent to earn the right to ask.

**"Do not manufacture questions to justify the command."** A skill whose stated purpose is asking questions will always find some. Without an explicit escape hatch, an agent that has genuinely resolved everything will invent an ambiguity rather than report a clean audit. The rule gives it permission to come back and say there is nothing to decide, here are the assumptions I am proceeding under, which is frequently the correct answer.

**"Give each question a recommendation and its stakes."** A bare question transfers the whole decision to you, including the research. A question that names the option the agent would take, why, and what changes if you choose otherwise, lets you answer "your call" on the ones you do not care about and spend your attention on the ones you do. It also exposes bad questions: if the agent cannot say what changes based on the answer, the question should not have been asked.

The batching matters too. Questions arriving one at a time, mid-build, are the thing this replaces. Each one costs a context switch, and by the third one the agent has already written code against its guess at the first. One batch, up front, answered together, then a clean run.
