---
type: post
title: "Snapshots for AI: A \"RAG-Like\" solution for programming with LLMs"
slug: snapshots-for-ai-a-rag-like-solution-for-programming-with-llms
author: atwellpub
status: published
visibility: public
publishedAt: 2024-07-30
updatedAt: 2024-12-02
excerpt: "Picture this: You’re a developer, deep in the trenches of a complex project. Your trusty AI assistant, powered by a Large Language Model (LLM), has been by your side, helping you tackle bug after b…"
categories: ["devops"]
layout: editorial
coverImage: "./images/atwellpub_gohan_with_glasses_going_kaioken_while_working_on_a_c_f3ddfd7f-574e-4c07-adf8-05871411146a.webp"
redirectFrom: ["/devops/snapshots-for-ai-a-rag-like-solution-for-programming-with-llms/"]
---

**Picture this:** You’re a developer, deep in the trenches of a complex project. Your trusty AI assistant, powered by a Large Language Model (LLM), has been by your side, helping you tackle bug after bug, feature after feature. It’s been a productive day, but as the hours tick by, you notice something… off.

Your AI companion, once sharp and helpful, starts to fumble. It suggests solutions you’ve already tried and discarded. It references code you’ve long since updated. Worst of all, it proposes changes that would reintroduce bugs you painstakingly squashed earlier in the day.

What’s going on? The harsh truth hits you: your LLM is losing context. It’s struggling to keep up with the rapid evolution of your codebase. Those brilliant refactors you made an hour ago? Forgotten. The elegant solution you crafted for that tricky edge case? A memory.

But what if there was a better way?

Because we have experienced these pain points firsthand, we understand it is our current responsibility as humans to give the models their best chances of success. To help with this mission, we’ve been working on an answer to the question, _“How can we better interact with our LLM coding assistants to maximize success?”_

Introducing [Snapshots for AI](https://plugins.jetbrains.com/plugin/24889-snapshots-for-ai/), a plugin for _PHPStorm_ with a [Python script](https://github.com/gbti-labs/py-snapshots-for-ai) as a predecessor.

## What is Snapshots for AI?

At its core, Snapshots for AI generates machine-readable [markdown](https://gbti.network/frameworks/what-is-markdown/) snapshots of the files you’re currently working on (examples of what a markdown snapshot looks like are provided later in this article — [click here to skip to example](#example) )

The snapshots can be quickly and easily fed to your favorite LLM, providing it with up-to-date, focused context about your project. This process ensures that your AI assistant always has the most current information about your codebase, leading to more accurate and relevant suggestions.  
  
Here’s a quick video introduction of the plugin in action:

## Example Snapshot: Markdown Export of an Application

The below code block shows an example markdown export (aka snapshot) that is machine-readable and can be fed to the LLM. This particular example contains multiple ways to print the words “Hello World” using several different programming languages.:

`` Hi there, please consider this application as it is the latest iteration  of the project we have been working on together. Once you review it, please  list 5 potential recommended courses of action in a numbered ordered list and  ask which path we would like to take.   # Project Structure  ``` src ├── main │   ├── python │   │   └── hello_world.py │   ├── php │   │   └── hello_world.php │   └── javascript │       └── hello_world.js ```  # Project Files  - `src/main/python/hello_world.py` - `src/main/php/hello_world.php` - `src/main/javascript/hello_world.js`  ## src/main/python/hello_world.py ```python # hello_world.py  def main():     print("Hello, World!")  if __name__ == "__main__":     main() ```  ## src/main/php/hello_world.php ```php <?php echo "Hello, World!"; ?> ```  ## src/main/javascript/hello_world.js ```javascript console.log("Hello, World!"); ``` ``
Currently, this plugin is available for both the 2023 and 2024 versions of the PHPStorm IDE. You can download it here:  
  
[https://plugins.jetbrains.com/plugin/24889-snapshots-for-ai/](https://plugins.jetbrains.com/plugin/24889-snapshots-for-ai/)

## Snapshots for AI is a “RAG-like” solution

**Retrieval-Augmented Generation (RAG)** is an emerging AI technique that enhances large language models with the ability to access and utilize external knowledge. While promising, RAG systems are still in their early stages of development and adoption. Many developers continue to interact with LLMs directly through official portals like OpenAI’s ChatGPT interface or Anthropic’s Claude platform.

[https://www.youtube.com/@MannyBernabe](https://www.youtube.com/@MannyBernabe)

It’s important to note that in the current landscape of LLM services, like [GPT-4](https://chatgpt.com/) and [Claude 3,](https://claude.ai/) subscription-based access (like ChatGPT Plus) and API usage often have different pricing structures.

Subscription models typically offer a flat rate for a certain level of usage, while API calls are priced per token. True RAG setups, which rely heavily on API calls for both retrieval and generation, can quickly become costly as usage scales up, especially for larger projects or teams.

The Snaphsots for AI allows developers to benefit from some RAG-like capabilities – namely, augmenting the LLM’s knowledge with current, project-specific information – without the complexity and potential cost scaling of a full RAG system.

## From Python Script to IDE Plugin

Before building an IDE plugin for this concept, we first developed a [Python script](https://github.com/gbti-labs/py-snapshots-for-ai) that could be run at the command line. This script, in essence, was the spiritual predecessor to the PHPStorm plugin we would eventually build. It was very effective at updating the LLM with the most recent context of a code base, allowing the LLM to focus on the task at hand.

This script was published as open-source software under the title [Snapshots.py for AI](https://github.com/gbti-labs/py-snapshots-for-ai).

## What are some example use cases for Snapshots for AI?

**Debugging Unfamiliar Languages**: When you’re working with a language you’re not familiar with and encounter a compile error, you can use Snapshots to quickly provide context to the LLM.

**Maintaining Context in Long LLM Sessions**: LLM performance can decline in long sessions. Snapshots allows you to quickly start a new session and bring the LLM up to speed with your environment and code.

**Code Refactoring and Improvement**: The LLM is a strong coding partner that can help you quickly develop small applications as well as refactor or improve larger applications.

In the **example ChatGPT session below**, I ask the LLM to help debug an issue with the Snapshots for AI plugin’s exclusion and inclusion patterns behavior:

[https://chatgpt.com/share/a7acad08-77b6-412c-bdd2-f0fe311dd4ef](https://chatgpt.com/share/a7acad08-77b6-412c-bdd2-f0fe311dd4ef)

## Comparing Snapshots for AI with other AI Coding Tools

While tools like [Cursor.sh](https://www.cursor.com/), [GitHub Copilot](https://github.com/features/copilot), and [Tabnine](https://www.tabnine.com/) are excellent in their own right, [Snapshots for AI](https://plugins.jetbrains.com/plugin/24889-snapshots-for-ai/) offers some unique advantages:

1.  **Focused Context**: Unlike [Cursor.sh](https://www.cursor.com/), which can feed an entire repo to an LLM, Snapshots allows you to selectively choose which files to include. This may help provide greater focus to the LLM when solving a problem.
2.  **Custom Prompts**: Unlike [GitHub Copilot](https://github.com/features/copilot), which primarily focuses on code completion, Snapshots allows you to add custom prompts to guide the LLM’s response. This is particularly useful for complex problem-solving scenarios.
3.  **Integration with Existing Workflows**: As a [PHPStorm](https://www.jetbrains.com/phpstorm/) user, this was a good PHPStorm-powered solution, much better than the Python script we initially created.

We also wanted to send a shout-out to [16x Prompt Engineer](https://prompt.16x.engineer/), who seems to be an application-based comparable approach to Snapshots for AI.

## Looking Ahead

As LLMs continue to evolve to support coders, tools like [Snapshots for AI](https://plugins.jetbrains.com/plugin/24889-snapshots-for-ai/) will play a healthy role in bridging the gap between human developers and LLM assistants. I’m personally excited to see how developers at all levels will use this tool to enhance their productivity and problem-solving capabilities and I’m also excited to see what the future brings in regard to LLM assisted development.

Happy coding, and here’s to pushing the boundaries of what’s possible in software development!
