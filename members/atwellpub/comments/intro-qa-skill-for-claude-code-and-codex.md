---
id: intro-qa-skill-for-claude-code-and-codex
targetType: prompt
targetSlug: qa-skill-for-claude-code-and-codex
createdAt: '2026-07-31T02:55:24.940Z'
status: published
visibility: public
authorNote: true
type: comment
author: atwellpub
---

I wrote this because my work sprints kept ending the same way: with raised questions. The work would
wrap up, and only then would the open decisions surface, at the point where acting on them meant
redoing something.

So I gave myself a way to invoke the pass I wanted, on demand. Typing `/qa` gets the questions asked, in
plan mode, before anything is written. `/qa continue` does the same and then just builds once I have
answered.

I keep the default narrow on purpose. It reads only what the agent just told me and asks about that,
because that is the case I actually hit, and a full sweep of the repository on every invocation is
more tokens than the job is worth. `/qa deep` is there for when I do want the wide pass.

The rest of the file exists to keep the questions worth answering: audit the repository first so it
never asks what the code already says, and say plainly when there is nothing left to decide rather than
inventing something to ask.
