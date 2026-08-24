---
type: prompt
title: Run the GBTI MCP server from the Chrome extension folder
slug: install-gbti-network-from-extension
shortDescription: >-
  Point Claude Code at the GBTI MCP server that ships inside the Chrome extension folder, sign in,
  and publish content without a separate install.
author: gbtilabs
status: draft
visibility: public
categories:
  - devops
  - tooling
tags:
  - gbti-network
  - mcp
  - chrome-extension
  - onboarding
  - claude-code
targets:
  - Claude Code
exampleOutput: >-
  Register the GBTI MCP server straight from the unpacked Chrome extension folder, sign in with
  GitHub device flow, and publish posts, products, and prompts through the gated pull-request flow,
  with no npm install and no browser needed after sign-in.
publishedAt: 2026-06-10T00:00:00.000Z
---

You are setting up GBTI Network authoring inside Claude Code by running the MCP server that ships INSIDE the GBTI Chrome extension folder. The extension does not run this server; Claude Code runs it from disk. After this, I can publish posts, products, and prompts through GBTI's pull-request flow, and it keeps working with the browser closed.

Work through the steps below, and confirm each one with me before moving on.

1. Find the extension folder. If I installed the GBTI extension UNPACKED, ask me for the folder path I loaded (the folder that contains `manifest.json`). If I am not sure, tell me to open `chrome://extensions`, turn on Developer mode, find "GBTI Network", and copy the path shown under it. The MCP server is at `<that folder>/mcp/gbti-network-mcp.mjs`.

2. Confirm Node is available. Run:

   ```bash
   node --version
   ```

   I need Node 18 or newer. The server is a single self-contained file, so there is nothing to `npm install`.

3. Register the GBTI MCP server with Claude Code, pointing at the file in the extension folder. Run (replace the path with mine):

   ```bash
   claude mcp add gbti-network -- node "/absolute/path/to/extension/mcp/gbti-network-mcp.mjs"
   ```

   If I manage MCP servers through a config file instead, add this entry (with my real path):

   ```json
   {
     "mcpServers": {
       "gbti-network": { "command": "node", "args": ["/absolute/path/to/extension/mcp/gbti-network-mcp.mjs"] }
     }
   }
   ```

4. Sign me in with GitHub. Call the `login` MCP tool. It returns a verification URL and a short code. Give me both, and tell me to open the URL, enter the code, and approve. Then call the `login_confirm` tool. If it returns `pending`, wait a moment and call `login_confirm` again. Repeat until it returns `ok` with my identity. This uses GitHub device flow on the shared GBTI app and stores no secret; once I am signed in, publishing works even with my browser closed.

5. Confirm the connection. Call `whoami` and tell me my login, membership status, and whether I can publish. Then list the `gbti-network` MCP tools and summarize what each lets me do, especially `add_prompt`, `add_product`, `add_post`, `validate_content`, and `list_prs`.

6. Remind me of the rules of the road:

   - Publishing is for paid members. On a free trial, my drafts stay on my own fork until I upgrade.
   - Every change ships as a pull request through the GBTI gate, and the gate is the only thing that merges it. Nothing here can write to the live site directly.
   - I can publish into my own member folder. To change another member's folder, that folder owner has to approve my contribution.

When setup is verified, ask me what I would like to create first, and offer to draft it and open the pull request with `add_prompt`, `add_product`, or `add_post`.
