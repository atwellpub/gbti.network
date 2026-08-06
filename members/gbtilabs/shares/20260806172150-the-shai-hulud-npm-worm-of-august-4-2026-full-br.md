---
status: published
visibility: public
title: >-
  The Shai-Hulud npm Worm of August 4, 2026: Full Breakdown of the Attack That Poisoned 1,280+
  Packages
shortDescription: >-
  On August 4, 2026, the npm ecosystem experienced one of the most devastating software supply chain
  attacks in history.
url: >-
  https://www.studioglobal.ai/discover/answers/what-happened-during-the-shai-hulud-worm-attack-6a72f00ac4b1e0057435cc25
image: >-
  https://production-storage-studioglobal.s3.ap-southeast-1.amazonaws.com/chat/EORaotpyJOhXQrnzEaHzxW1xXhD2/images/B26D0E09BBC7E9C44AF3/AE52497A233F14D18F85.png
category: security
tags:
  - npm
  - supply-chain
  - malware
  - shai-hulud
id: 20260806172150-the-shai-hulud-npm-worm-of-august-4-2026-full-br
createdAt: '2026-08-06T17:21:50.038Z'
type: share
author: gbtilabs
---

On August 4, 2026, attackers reportedly compromised the GitHub account of the maintainer behind keyv, flat-cache, and related packages, then pushed a self-propagating npm worm that spread to more than 1,280 packages with roughly 2 billion monthly downloads. The malware ran through a preinstall script, stole credentials such as npm tokens, GitHub tokens, cloud keys, SSH keys, and other secrets, then used those credentials to infect additional packages across unrelated organizations. Any system that installed an affected version should be treated as fully compromised: pin or roll back dependencies, remove persistence mechanisms, rotate all exposed credentials, clear caches, and rebuild systems from scratch.
