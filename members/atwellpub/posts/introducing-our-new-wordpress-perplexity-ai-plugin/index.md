---
type: post
title: "Introducing a new WordPress Perplexity AI plugin"
slug: introducing-our-new-wordpress-perplexity-ai-plugin
author: atwellpub
status: published
visibility: public
publishedAt: 2025-06-30
updatedAt: 2025-07-29
excerpt: "Introducing our WordPress Perplexity Plugin for AI-powered text lookups. Allow readers to quickly drill down into topics with Perplexity AI."
categories: ["ai"]
layout: journal
coverImage: "./images/featured-image-3.webp"
redirectFrom: ["/ai/introducing-our-new-wordpress-perplexity-ai-plugin/"]
---

As content creators, writers worldwide consistently ask themselves how they can help their readers learn more about a concept without going into an excessive explanation that risks the flow of their message _(and the average reader’s attention)_.

Writers struggle with using hyperlinks effectively because excessive linking can harm both readability and SEO[^1] performance.

While they may _italicize_ or **bold text** for emphasis, this approach doesn’t provide context or allow readers to explore topics in depth. To compensate, they invent systems like [footnotes](https://gbti.network/ai/chicago-style-footnoting-in-ai-generated-content/) but constantly worry whether their notes are too long or too short to adequately explain a subject.

From a reader’s perspective, when none of the above helpers are present, they simply ” Google” something to learn more about it.

Now, with the advent of LLMs, we’ve seen the landscape begin to shift.

> As content creators, how can we help our readers verify, investigate and cross reference our content without over stimulating them?

LLM chatbots like ChatGPT, Claude, and websites like PerplexityAI have become the user-preferred replacement for traditional Google search, while the trend to leave Google and use these tools is only increasing over time.

We are in the Brave New World of user experience, so how can we adapt?

> How can we make topic exploration _less_ invasive while giving readers agency to decide when to drill down into specific concepts?

One answer is to leverage a browser’s _text highlighting_ feature and provide a toolbar for leveraging these new AI tools.

Combined with JavaScript event listeners, we can capture text highlight events and prompt the user with an option to drill down deeper into a subject.

All we need to do on our end is decide which AI service we are going to offer to our readers, and the one we chose for this website is [Perplexity AI](https://www.perplexity.ai/).  
  
**Why Perplexity AI?**

We wanted to select an AI service that was not gatekept by user accounts or paywalls. We wanted something similar to Google that accepted query-based search but with the computational power of a large language model. Perplexity was the natural choice for this _pilot_[^2].

> We knew a feature like this was something that someone would build eventually, and we were surprised when we did not find it or see anyone else doing it. So we built it ourself.

Our _**WordPress Perplexity Plugin**_ (link at the bottom of the article) addressed our goals through a streamlined _text-selection-lookup-me_chanism.

At the time of writing this article we have already installed this tool on this website and it should be active now; however, _**the current implementation only works on non-mobile devices**_[^3]. So if you are on your desktop then please, go ahead and give it a try!

_Highlight some text  
Click the Perplexity button to open Perplexity in a new tab  
And you should see an_ extrapolation of your highlighted _text,  
Providing additional information._

Google wasn’t a bad system for research, but Perplexity appears better suited for educational side-quests.

And that’s it!

Overall, the final implementation that we developed is simple and lightweight. It is only active on the blog “post” post type for WordPress and comes with hardcoded controls that a WordPress administrator can edit before installing this plugin.

**So, what’s next?**

In the future, this idea could _(and should!)_ be expanded to:

1.  Activate services beyond Perplexity, such as ChatGPT, Claude, and Grok.
2.  Collect and store query information to help site administrators understand what their users are looking up.
3.  Implement additional tool items such as printing features or social share features.
4.  Implement additional prompt formats for additional control on how information is prompted.
5.  Mobile support.

This effort we’ve created and shared with you today is just the bare minimum, but it is working quite well for us, and we hope you enjoy it, too.

## How to Download

The [WordPress Perplexity Plugin](https://gbti.network/products/wordpress-perplexity-plugin/) is available and can be downloaded for free through the [GitHub repository](https://github.com/gbti-network/wordpress-perplexity-plugin).

Development and maintenance is handled by our members here at the [GBTI Network](https://gbti.network); a private members network and cooperative with a passion for product and content development. We’re always looking for new blood to join our community so check us out!

We hope you enjoy this plugin! If you need help installing it, or would like something similar built for your platform, [please let us know](https://gbti.network/hire/wordpress-developers/)! We can help arrange talent very quickly for your small and large projects alike.


[^1]: **Search Engine Optimization (SEO)** is the process of improving a website’s visibility in search engines.
[^2]: **A** _**pilot program**_ is a small test run before full implementation.
[^3]: Unfortunately, we have experienced technical difficulty in getting queries to pass from browser to the mobile Perplexity app on iOS. We ideally want this feature to work for mobile devices, too, and it should, but until we have a work around we need to leave it enabled for Desktops only.
