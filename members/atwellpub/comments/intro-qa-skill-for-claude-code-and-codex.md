---
id: intro-qa-skill-for-claude-code-and-codex
targetType: prompt
targetSlug: qa-skill-for-claude-code-and-codex
createdAt: '2026-07-30T21:12:09.929Z'
status: published
visibility: public
authorNote: true
type: comment
author: atwellpub
---

I wrote this one after watching an agent make three silent decisions in a row on a task I thought was
fully specified. None of them were unreasonable. All three were wrong, and I did not find out until the
work was finished and I had to unpick which assumption caused which problem.

The fix is not a better prompt, it is a different order of operations: audit the code, collect every
decision that is genuinely mine to make, ask them together, then build. That is all `/qa` is. Plan mode
is what makes it stick, because the agent cannot quietly start editing while it is still asking.

The two rules I would keep if you strip everything else out are "never ask what the repository can
answer" and "do not manufacture questions to justify the command". Without the first, the agent asks you
things it could have read, and you stop using it by the second session. Without the second, it invents
ambiguity when the honest answer is that there is nothing left to decide.
