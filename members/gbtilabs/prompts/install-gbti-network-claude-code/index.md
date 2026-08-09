---
type: prompt
title: Install GBTI Network Access in Claude Code
slug: install-gbti-network-claude-code
shortDescription: >-
  Set up GBTI Network authoring access in Claude Code, from installing the client to publishing
  through the gated pull-request flow.
author: gbtilabs
status: published
visibility: public
categories:
  - devops
  - tooling
tags:
  - GBTI Network
  - MCP
  - Onboarding
  - claude-code
targets:
  - Claude Code
exampleOutput: >-
  Set up GBTI Network authoring access inside Claude Code: install the client, register the MCP
  server, sign in with GitHub device flow, and start publishing through the gated pull-request flow.
publishedAt: 2026-06-06T00:00:00.000Z
---

You are setting up GBTI Network authoring access inside Claude Code, so I can publish and manage my GBTI Network content (posts, products, prompts, and my member profile) through GBTI's pull-request flow without touching Git by hand.

Work through the steps below, and confirm each one with me before moving on.

1. Install the GBTI Network client. Run:

   ```bash
   npm install -g gbti-network
   ```

   If I would rather not install it globally, tell me to use `npx gbti-network` instead.

2. Register the GBTI Network MCP server with Claude Code. Run:

   ```bash
   claude mcp add gbti-network -- npx gbti-network-mcp
   ```

   If I manage MCP servers through a config file instead, add this entry:

   ```json
   {
     "mcpServers": {
       "gbti-network": { "command": "npx", "args": ["gbti-network-mcp"] }
     }
   }
   ```

3. Sign me in to GitHub, through the MCP server itself (no separate command needed). Call the `login` tool. It returns a verification URL and a short code. Give me both, tell me to open the URL, enter the code, and approve. Then call the `login_confirm` tool. If it returns `pending`, wait a moment and call `login_confirm` again. Repeat until it returns `ok` with my identity. This uses GitHub device flow and stores no secret; once I am signed in, publishing keeps working with my browser closed.

   If I would rather sign in from the terminal, I can run `gbti login` instead (same device flow), then continue.

4. Confirm the connection. Call `whoami` and tell me my login, membership status, and whether I can publish. Then list the `gbti-network` MCP tools and summarize what each lets me do, especially:

   - `add_prompt`, `add_product`, `add_post`: create that content type and open a publish pull request.
   - `publish_content`: the general form (also handles a profile).
   - `validate_content`: check a draft against the schema before publishing.
   - `list_my_content`, `get_content`, `list_prs`, `pr_status`: review my content and the gate status of my pull requests.

5. Remind me of the rules of the road:

   - Publishing is for paid members. On a free trial, my drafts stay on my own fork until I upgrade.
   - Every change ships as a pull request through the GBTI gate, and the gate is the only thing that merges it. Nothing here can write to the live site directly.
   - I can publish into my own member folder. To change another member's folder, that folder owner has to approve my contribution.

When setup is verified, ask me what I would like to create first, and offer to draft it and open the pull request with `add_prompt`, `add_product`, or `add_post`.
