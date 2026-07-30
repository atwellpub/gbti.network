---
title: 'Resolve Open Questions: a /qa Skill for Claude Code and Codex'
slug: qa-skill-for-claude-code-and-codex
shortDescription: >-
  A drop-in /qa skill that forces every unresolved decision into one batch of questions before any
  code is written: audit the repo first, ask only what the code cannot answer, recommend an option
  for each, then build. One SKILL.md, installs in both Claude Code and Codex.
targets:
  - Claude Code
  - Codex
categories:
  - ai
  - prompts
  - skill
tags:
  - claude-code
  - codex
  - agent-skills
  - planning
  - workflow
publishedAt: '2026-07-30T19:37:31.690Z'
status: published
type: prompt
author: atwellpub
---

Claude Code and Codex both load a markdown file at `<skills-dir>/<name>/SKILL.md` as a reusable skill, and both read the same two frontmatter keys: `name` and `description`. That means one file, dropped into two directories, gives you the same command in both agents. This one is `/qa`: it stops the agent, pulls every unresolved decision into a single batch of questions, and refuses to write code until you have answered them.

It exists because of a specific failure mode. An agent handed an ambiguous task does not stop. It picks, quietly, and the pick is invisible until the work is done and wrong. The expensive part is never the coding, it is discovering three files later that the agent assumed a different scope, a different storage location, or a different tier of user than you meant. `/qa` inverts that: the assumptions surface as questions, at the front, while changing your mind is still free.

## Install

The same `SKILL.md` works in both agents. Pick your host, or install it in both.

**Claude Code**

1. Create `.claude/skills/qa/` in your repo, or `~/.claude/skills/qa/` to have it everywhere.
2. Save the file below as `SKILL.md` inside it.
3. Type `/qa` in Claude Code.

**Codex**

1. Create `.agents/skills/qa/` in your repo, or `$HOME/.agents/skills/qa/` to have it everywhere. Codex scans `.agents/skills` from the working directory upward to the repository root.
2. Save the same file as `SKILL.md` inside it.
3. Type `$qa` in Codex, or just describe what you want and let Codex match the skill implicitly from its description.

A note on the Codex side: custom prompts under `~/.codex/prompts/`, invoked as `/prompts:qa`, are deprecated in favor of skills. Skills are the current mechanism, they can be invoked implicitly, and they travel with the repository. Install this as a skill, not a prompt.

Nothing to configure. The skill reads your project, not a config file.

## The skill file

````markdown
---
name: qa
description: >
  Surface and resolve every outstanding question before the work proceeds. Invoke for "/qa",
  "/qa continue", "/qa proceed", "/qa <topic>", or when the user asks you to ask all your questions
  first, question everything unresolved, or clarify requirements before building. Every mode holds a
  read-only planning state and asks every open question at once. Bare "/qa" then presents a plan for
  approval; "/qa continue" and "/qa proceed" skip that approval round and build straight from the
  answers. Any other trailing text is a context-rich instruction that scopes what to interrogate.
---

# /qa: resolve the open questions before building

The point of this command is to move every decision that is the user's call OUT of your head and
into one batch of questions, answered before any code is written. No silent defaults, no drip of
ad-hoc questions later.

## Hold a planning state while you ask

Whatever your host calls it, change nothing between the invocation and the answers. Read, search and
trace freely; write nothing.

- **Claude Code:** enter plan mode (`EnterPlanMode`) and leave it with `ExitPlanMode`. Invoked `/qa`.
- **Codex:** stay in a read-only approval mode and apply no edits. Invoked `$qa`.

The argument conventions below are identical on both.

## Read the argument first, it selects the mode

| Invocation | Mode |
|---|---|
| `/qa` | **Ask and hold.** Enter the planning state, ask every outstanding question, then present a plan for approval. Write nothing until approved. |
| `/qa continue` or `/qa proceed` | **Ask and go.** Same planning state, same questions. What it skips is the confirmation before acting, so once the answers land you build straight from them, with no plan written for review. |
| `/qa <anything else>` | **Scoped.** The trailing text is a context-rich instruction naming the subject to interrogate. Planning state either way; default to ask-and-hold, unless the text also says continue or proceed, which drops the approval round for that scoped subject. |

Every mode holds the planning state until the questions are answered. The modes differ ONLY in
whether a plan gets approved before you act, and the question-gathering work below is identical in
all of them.

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
- In ask-and-hold mode, present the plan for approval. In continue/proceed mode, leave the planning
  state as soon as the answers land and build, without composing a plan for review. Some hosts still
  surface a single confirmation on the way out; that is a formality, not a review round, so keep
  what you write there to a line or two.
- If something genuinely new surfaces mid-build, finish everything that does not depend on it, then
  raise the one question at the right moment.

## Reminders

- Follow the project's own conventions for planning and for writing.
- The command is about decisions, not permission. Do not turn it into a request to confirm work the
  user already asked for.
````

## The three modes

The argument selects the mode, and the only difference between them is whether a plan gets approved before the agent acts.

- **`/qa`** is ask and hold. The agent enters a read-only planning state, asks everything, then presents a plan for your approval. Use it when the work is large enough that you want to see the shape before it starts.
- **`/qa continue`** or **`/qa proceed`** is ask and go. Same planning state, same questions, but once you answer it builds straight from your answers with no plan to approve. This is the everyday mode: you still get interrogated, you just do not get asked twice.
- **`/qa <anything else>`** scopes the interrogation. `"/qa the rate limiter"` asks everything unresolved about the rate limiter specifically, rather than the whole task.

## Making it yours

**Map the planning state to your host.** The skill states the rule behaviorally, that nothing changes between the invocation and the answers, and then names each host's mechanism: plan mode in Claude Code, a read-only approval mode in Codex. If your setup uses different approval gates, edit those two lines and leave the rest alone.

**Tune where questions hide.** Step 2 lists six places to sweep. The list is deliberately generic, so add the categories your projects actually produce. A team with a design system adds "which token or component does this reuse". A team with a data model adds "does this change a stored shape, and what happens to existing rows". A regulated project adds an approvals category. The sweep is only as good as its list.

**Point it at your planning docs.** The highest-yield item in the sweep is a governing document with an open-questions section, since those questions are already written and already yours to answer. If your project keeps scopes of work, tickets or design docs, name that location explicitly in step 2 so the agent reads it every time.

## Why the odd details are in there

Three rules in the file look like padding and are not. Each one is a failure mode that shows up the moment you make an agent ask questions.

**"Never ask what the repository can answer."** The first thing an unconstrained question-asking agent does is ask you things that are written in the code. Where does this live, what is this called, does this exist. It feels thorough and it is worthless, and after two rounds of it you stop using the command. The audit-first rule forces the agent to earn the right to ask.

**"Do not manufacture questions to justify the command."** A skill whose stated purpose is asking questions will always find some. Without an explicit escape hatch, an agent that has genuinely resolved everything will invent an ambiguity rather than report a clean audit. The rule gives it permission to come back and say there is nothing to decide, here are the assumptions I am proceeding under, which is frequently the correct answer.

**"Give each question a recommendation and its stakes."** A bare question transfers the whole decision to you, including the research. A question that names the option the agent would take, why, and what changes if you choose otherwise, lets you answer "your call" on the ones you do not care about and spend your attention on the ones you do. It also exposes bad questions: if the agent cannot say what changes based on the answer, the question should not have been asked.

The batching matters too. Questions arriving one at a time, mid-build, are the thing this replaces. Each one costs a context switch, and by the third one the agent has already written code against its guess at the first. One batch, up front, answered together, then a clean run.
