---
title: The VSCode terminal GPU setting has a fallback that never comes back
slug: vscode-terminal-gpu-acceleration
excerpt: >-
  The terminal gpuAcceleration setting defaults to auto, which stops using the WebGL renderer the
  first time it falls back, and does not return for the rest of the session.
categories:
  - devops
  - tooling
tags:
  - vscode
  - terminal
  - performance
  - wsl
status: draft
type: post
author: atwellpub
---

## Overview

VSCode renders its integrated terminal with xterm.js, which can draw either through WebGL on the GPU or through the DOM on the CPU. Which one you get is controlled by `terminal.integrated.gpuAcceleration`, and the default value is `auto`.

Most people never touch this setting, and most of the time that is fine. It becomes worth knowing about when you keep several busy terminals open at once, because `auto` has a behavior that the setting name does not suggest.

## What auto actually does

The decision lives in one expression in the shipped bundle. Reformatted from the minified source in version 1.131:

```js
gpuAcceleration === "auto" && _suggestedRendererType === undefined
  || gpuAcceleration === "on"
```

Read the first branch carefully. On `auto`, WebGL is used only while `_suggestedRendererType` is `undefined`. Once VSCode sets that value, and it sets it when it concludes another renderer is more suitable, for example after a WebGL context failure, the first branch is false from then on. The terminal drops to the DOM renderer and stays there.

Nothing in the interface tells you this happened. There is no notification and no status indicator. The terminal simply becomes more expensive to draw, and it remains that way.

The value is not recomputed on its own either. The only thing that clears it during a session is changing the setting, which VSCode watches for:

```js
if (e.affectsConfiguration("terminal.integrated.gpuAcceleration")) {
  _suggestedRendererType = undefined;
}
```

So the practical shape of `auto` is a one-way switch. It can fall back, and short of editing the setting or restarting, it does not return.

## Why this matters on a loaded machine

A WebGL context is a finite resource, and a browser process will drop one under memory pressure. VSCode is a browser process. If you are running several windows, a large extension set, and terminals that redraw continuously, the conditions that cost you the WebGL context are the same conditions where CPU rendering hurts most.

Agent tooling makes this more likely than it used to be. A terminal running a coding agent is not printing occasional lines of output. It is repainting a live interface: spinners, streaming text, status lines, progress. Several of those at once is sustained render load rather than bursts. If one of them loses the GPU renderer early in a long session, every repaint after that is drawn by the CPU.

## Turning it on

Open your user settings JSON with `Preferences: Open User Settings (JSON)` from the command palette, and add:

```json
"terminal.integrated.gpuAcceleration": "on"
```

The three accepted values are:

- `auto`, the default, described above.
- `on`, which uses WebGL and removes the fallback branch entirely.
- `off`, which uses the DOM renderer always.

The setting applies to terminals as they are created. Existing terminals keep the renderer they started with, so open a new one to see the change, or restart the window to move all of them at once.

## Checking whether it is working

Run `Developer: Toggle Developer Tools`, open the Console, and create a new terminal. A WebGL context failure logs there, which is the clearest signal that `auto` would have fallen back.

For a rough before and after, open the Performance tab, record while a terminal is producing steady output, and compare time spent in scripting and rendering. You are looking for a difference in scale rather than a precise number.

## When to leave it alone

Forcing `on` is not free of tradeoffs.

Over a remote desktop session, through some VM graphics drivers, and on machines with no usable GPU, WebGL is either unavailable or slower than the DOM renderer. In those cases `auto` falling back is the correct outcome, and forcing `on` removes a safety valve that exists for a reason.

Rendering problems are the signal to revert. Missing or misaligned glyphs, incorrect colors, or a blank terminal panel all point at the WebGL path, and setting the value back to `auto` or `off` is the fix.

## The editor setting is separate

`editor.experimentalGpuAcceleration` also exists and is unrelated. It controls GPU rendering for the text editor rather than the terminal, it is experimental, and it is off by default. Changing one does not affect the other. If you are chasing terminal performance specifically, the terminal setting is the one you want.

## Worth knowing, not a cure

This setting is one contributor among several. File watching over large dependency trees, extension host work, and the number of open windows all affect how a VSCode window feels, and none of them are fixed by choosing a renderer. What makes `gpuAcceleration` worth understanding is that the default can silently degrade partway through a session, which makes it hard to attribute later. Setting it explicitly removes that variable, which is useful whether or not it turns out to be the one that mattered.
