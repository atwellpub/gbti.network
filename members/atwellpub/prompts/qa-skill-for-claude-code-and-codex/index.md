---
title: 'Resolve Open Questions: a /qa Skill for Claude Code'
slug: qa-skill-for-claude-code-and-codex
shortDescription: >-
  A drop-in /qa skill for Claude Code that forces every unresolved decision into one batch of
  questions before any code is written: hold plan mode, audit the repo first, ask only what the code
  cannot answer, recommend an option for each, then build.
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
updatedAt: '2026-07-30T21:13:53.606Z'
status: published
type: prompt
author: atwellpub
---

Claude Code loads any markdown file at `.claude/skills/<name>/SKILL.md` as a reusable slash command (a "skill"). This one gives your agent a `/qa` command that stops before it builds, pulls every unresolved decision into a single batch of questions, and refuses to write code until you have answered them.

It exists because open questions have a habit of surfacing at the wrong end of the work. A sprint finishes, and only then does the agent raise the decisions it should have raised at the start, at exactly the point where acting on them means redoing something.

The obvious fix is a standing instruction: a line in your memory or project file telling the agent to take any decision that is yours into plan mode and ask first. In practice that is a weak trigger. It fires when the agent happens to notice, which is not the same as reliably, and the sessions where it does not fire are the ones that cost you. An explicit command is a strong trigger, because you pull it.

So the mechanism is plan mode, invoked deliberately. The agent puts ITSELF into a read-only state, does its research there, asks everything it found in one batch, and only then acts. That ordering is the whole feature.

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
  Surface and resolve every outstanding question before the work proceeds. Invoke for "/qa",
  "/qa continue", "/qa proceed", "/qa <topic>", or when the user asks you to ask all your questions
  first, question everything unresolved, or clarify requirements before building. Every mode enters
  plan mode and asks every open question at once. Bare "/qa" then presents a plan for approval;
  "/qa continue" and "/qa proceed" skip that approval round and build straight from the answers. Any
  other trailing text is a context-rich instruction that scopes what to interrogate.
---

# /qa: resolve the open questions before building

The point of this command is to move every decision that is the user's call OUT of your head and
into one batch of questions, answered before any code is written. No silent defaults, no drip of
ad-hoc questions later.

## Read the argument first, it selects the mode

| Invocation | Mode |
|---|---|
| `/qa` | **Ask and hold.** Enter plan mode (`EnterPlanMode`), ask every outstanding question, then present a plan for approval (`ExitPlanMode`). Write nothing until approved. |
| `/qa continue` or `/qa proceed` | **Ask and go.** Still plan mode: enter it and ask the same questions. What it skips is the confirmation before acting, so once the answers land you build straight from them, with no plan written for review. |
| `/qa <anything else>` | **Scoped.** The trailing text is a context-rich instruction naming the subject to interrogate. Plan mode either way; default to ask-and-hold, unless the text also says continue or proceed, which drops the approval round for that scoped subject. |

Every mode enters plan mode and holds its read-only discipline until the questions are answered. The
modes differ ONLY in whether a plan gets approved before you act, and the question-gathering work
below is identical in all of them.

## Step 1: audit before you ask

Never ask what the repository can answer. Read the real code, the governing doc, and the recent
history first, so every question you ask is one that genuinely cannot be resolved without the user.
A question the code already answers is noise, and it teaches the user that /qa wastes their time.

## Step 2: where the outstanding questions hide

Sweep all of these, not just the obvious one:

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
- **Say so when there are none.** If the audit resolved everything, report that plainly and state
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

## The three modes

The argument selects the mode, and the only difference between them is whether a plan gets approved before the agent acts.

- **`/qa`** is ask and hold. The agent enters plan mode, asks everything, then presents a plan for your approval. Use it when the work is large enough that you want to see the shape before it starts.
- **`/qa continue`** or **`/qa proceed`** is ask and go. Same plan mode, same questions, but once you answer it builds straight from your answers with no plan to approve. This is the everyday mode: you still get interrogated, you just do not get asked twice.
- **`/qa <anything else>`** scopes the interrogation. `"/qa the rate limiter"` asks everything unresolved about the rate limiter specifically, rather than the whole task.

## Making it yours

**Tune where questions hide.** Step 2 lists six places to sweep. The list is deliberately generic, so add the categories your projects actually produce. A team with a design system adds "which token or component does this reuse". A team with a data model adds "does this change a stored shape, and what happens to existing rows". A regulated project adds an approvals category. The sweep is only as good as its list.

**Point it at your planning docs.** The highest-yield item in the sweep is a governing document with an open-questions section, since those questions are already written and already yours to answer. If your project keeps scopes of work, tickets or design docs, name that location explicitly in step 2 so the agent reads it every time.

**Decide how hard the hold is.** As written, bare `/qa` will not touch a file until you approve a plan. If that is heavier than you want for routine work, make `continue` the implied default in your copy and reserve the plan-approval round for large changes.

## Why the odd details are in there

Three rules in the file look like padding and are not. Each one is a failure mode that shows up the moment you make an agent ask questions.

**"Never ask what the repository can answer."** The first thing an unconstrained question-asking agent does is ask you things that are written in the code. Where does this live, what is this called, does this exist. It feels thorough and it is worthless, and after two rounds of it you stop using the command. The audit-first rule forces the agent to earn the right to ask.

**"Do not manufacture questions to justify the command."** A skill whose stated purpose is asking questions will always find some. Without an explicit escape hatch, an agent that has genuinely resolved everything will invent an ambiguity rather than report a clean audit. The rule gives it permission to come back and say there is nothing to decide, here are the assumptions I am proceeding under, which is frequently the correct answer.

**"Give each question a recommendation and its stakes."** A bare question transfers the whole decision to you, including the research. A question that names the option the agent would take, why, and what changes if you choose otherwise, lets you answer "your call" on the ones you do not care about and spend your attention on the ones you do. It also exposes bad questions: if the agent cannot say what changes based on the answer, the question should not have been asked.

The batching matters too. Questions arriving one at a time, mid-build, are the thing this replaces. Each one costs a context switch, and by the third one the agent has already written code against its guess at the first. One batch, up front, answered together, then a clean run.
