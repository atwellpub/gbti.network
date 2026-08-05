---
type: post
title: "Is our future full of MCP servers?"
slug: is-our-future-full-of-mcp-servers
author: atwellpub
status: published
visibility: members
publishedAt: 2025-02-21
updatedAt: 2025-02-22
excerpt: "In this recent GBTI member article, Hudson Atwell muses on the advent MCP Server usage for LLM & LLR model agents and how it may affect the future of content."
categories: ["ai", "llms"]
layout: journal
coverImage: "./images/mcp.webp"
redirectFrom: ["/ai/llms/is-our-future-full-of-mcp-servers/"]
---

MCP stands for **Model Context Protocol**, and recently the [Windsurf IDE](https://codeium.com/windsurf) released a new feature to their [_Cascade_](https://docs.codeium.com/windsurf/cascade) agent that enables support for connecting the Claude 3.5 to MCP servers.

The emergence of MCP servers in chat agents is still very new, but considering the current trajectory, there is a strong change that it could be very common in the near (and potentially distant) future. In this blog post I’ll share my thoughts about MCP and how it is already affecting the coding world as well as how it may affect the consumer and social aspects of the future.

To begin with, let’s look at how it’s being used to code and by getting a quick introduction of what MCP servers are and how they are being incorporated in the Windsurf IDE, a LLM integrated fork of VS Code:  

https://twitter.com/windsurf\_ai/status/1891664001941037123

[https://twitter.com/windsurf\_ai/status/1891664001941037123](https://twitter.com/windsurf_ai/status/1891664001941037123)

The **Model Context Protocol (MCP)** was introduced by [Anthropic in November 2024](https://www.anthropic.com/news/model-context-protocol) as _“a new standard for connecting AI assistants to the systems where data lives, including content repositories, business tools, and development environments.”_

Following the launch of the MCP protocol, websites like [glama.ai](https://glama.ai/mcp/servers) and [MCP.so,](https://mcp.so/) emerged to support the documentation and accessibility of open-source MCP servers, making servers available for a wide variety of applications. These MCPs, numbering over 1,000 at the time of writing, are opening up LLM access to platforms such as Google Drive, Slack, GitHub, [Clickup](https://glama.ai/mcp/servers/iwjvs2zy63), WordPress, and many others.

It may not be too long before the general public begins augmenting their own agent experiences with one-click MCP integrations that change the behavior of their agent experience.

Some mainstream examples would be: joining influencer-owned shopping networks, brand-owned content networks, financial data API access, and even local community news and events; all for the prompting waiting in the background of a normal agent experience.

![](./images/image-2.webp)

If LLM-powered micro internets are not considered a brave enough new world. It becomes even braver when the models we use leverage UI frameworks to assemble shopping portals inside the model container.  
  
But let’s bring it back to earth and away from the social and shopping-related examples and go to the more modern, pragmatic example. _How can it help make me a better coder, today?_

> How can it help make me a better coder, today?

Today, I am using the [Windsurf IDE](https://codeium.com/windsurf) to work on the [Traveler’s Series](https://modrinth.com/organization/gbti-network) Minecraft mods, and it is not easy work. For the bulk of it I’ve had to hire a Java coder, but I still want to be able to use the model to improve the code base and tackle low hanging fruit; while saving our human talent for the tougher problems.  
  
The difficulty with the above is that all the code is written in Java, and the API docs for Minecraft seem esoteric to me because I am not a Java developer and the game is very extensive. These docs are also on the web and cannot be downloaded as a zip, which makes access difficult. If I can somehow manage to create an MCP server to download and serve these docs directly to my agent, then I should be able to drastically improve the accuracy of the agent’s predictive capabilities.

For this reason I have set out to create a MCP server that does just that, but it will take some hard work to get it produced. Once I have it ready, I will test it and confirm whether or not it improved my experience working with Java for Minecraft mod development.

## Anthropic versus Open AI; MCPs versus “Plugins”

One question I have is… did Anthropic risk their future by naming these addons “MCP”s? The upcoming generation Z might not be attracted to this nomenclature due to the technical aspect of it. ChatGPT did have a plugin’s marketplace, but they [retired it in April 2024](https://help.openai.com/en/articles/8988022-winding-down-the-chatgpt-plugins-beta), citing many of the plugin hosted were becoming redundant to features added to the model itself; which was causing complications.  
  
The very reason MCPs are on my radar right now is because of the work Anthropic has done and my current favorite IDE adopting the standard.

GPT 4o is integrated with the Windfall IDE, but it does not appear to share the MCP integration feature anthropic offers. I may be wrong here. Let me know in the comments if so.

And while “plugins” seems like it would go far with the average consumer and “MCP” seems like it would go far only with developers. Yet, MCP appears to have no competition at all.  
  
Anyway, I’m trying my luck at building a node-based local MPC server that will help me connect my local Windsurf IDE for massive gains in Minecraft modding. I don’t know if it will work, but its worth exploring.  
  
And remember, it’s also always worth exploring the ways today’s technologies influence tomorrow’s consumer.  
  
Thanks for paying attention and remember, a read is a leader!  
