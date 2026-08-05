---
type: post
title: "Tutorial: How to edit messages in Minecraft's Flan mod"
slug: how-to-edit-flan-text-messages-in-minecraft
author: gbti
status: published
visibility: public
publishedAt: 2025-11-16
updatedAt: 2025-11-16
excerpt: "In this tutorial we show how to use datapacks to edit/override the default messaging of the Flan claims mod for Minecraft Java."
categories: ["entertainment", "gaming", "minecraft"]
layout: journal
coverImage: "./images/flan-datapack-darken-opt-cleanedimized.webp"
redirectFrom: []
---

[Flan](https://modrinth.com/mod/flan) is a popular server-side land claiming mod for Minecraft that helps administrators and players protect areas from being griefed with unwanted destruction. While Flan works great out of the box, server administrators may want to customize the default messages to better match their server’s theme or branding.

This guide will show you how to override Flan’s default message text by using a sever-side datapack (available for download below).

## Understanding Flan’s Message System

Flan uses Minecraft’s built-in translation system to display messages to players. Every message is associated with a **translation key** such as `flan.noPermissionSimple`, which maps to the text displayed to players.

### Common Flan Messages You Might Want to Change

-   `flan.noPermissionSimple` — Appears when players try to interact inside protected claims
-   `flan.noPermission` — Shown when a protected action is denied
-   `flan.inspectBlockOwner` — Displays the claim owner
-   `flan.claimCreateSuccess` — Shown after creating a claim
-   `flan.noPermissionTooClose` — Shown when too close to a claim boundary

## Using a Datapack to Modify Flan Messages

Creating a datapack is the cleanest and most maintainable method. Datapacks are _server-side_ only, so players do not need to download anything, however, the sever administrator (most likely you if you are reding this) will need to complete the following below.

### Step 1: Create the Datapack Structure

This is inside your server filesystem. Locate your world name and then find the datapacks folder. Create a custom data pack with the name `flan_custom_messages` and also create additional files and folders in the following structure:

`world/datapacks/flan_custom_messages/ ├── pack.mcmeta └── data/     └── flan/         └── lang/             └── en_us.json`

### Step 2: Create pack.mcmeta

Populate the pack.mcmeta file with the following content for Minecraft 1.21.1

`{   "pack": {     "pack_format": 48,     "description": "Custom Flan Messages"   } }`

**Minecraft pack\_format values:**

-   1.21 to 1.21.3: 48
-   1.20.5 to 1.20.6: 41
-   1.20.3 to 1.20.4: 26
-   1.20 to 1.20.2: 15

### Step 3: Create the Language Override File (en\_us.json)

Edit the `en_us.json` file with the following content:

`{   "flan.noPermissionSimple": "You cannot do that here!",   "flan.noPermission": "You don't have permission for this action.",   "flan.inspectBlockOwner": "Protected by: %1$s",   "flan.claimCreateSuccess": "Your claim has been established!",   "flan.noPermissionTooClose": "Too close to another claim!" }`

### Step 4: Apply the Changes

1.  Upload the folder to your server under `world/datapacks/`
2.  Run `/reload` or restart the server
3.  Verify that `file/flan_custom_messages` appears in `/datapack list`

### Adding Colors and Formatting

`{   "flan.noPermissionSimple": "§cYou cannot do that here!",   "flan.inspectBlockOwner": "§6Protected by: §e%1$s",   "flan.claimCreateSuccess": "§aYour claim has been established!" }`

**Color codes:**

-   §l bold
-   §o italic
-   §n underline
-   §m strikethrough
-   §r reset

| Code  | Color Name |
| --- | --- |
| `§0` | Black |
| `§1` | Dark Blue |
| `§2` | Dark Green |
| `§3` | Dark Aqua |
| `§4` | Dark Red |
| `§5` | Dark Purple |
| `§6` | Gold (Orange) |
| `§7` | Gray |
| `§8` | Dark Gray |
| `§9` | Blue |
| `§a` | Green |
| `§b` | Aqua (Light Blue) |
| `§c` | Red |
| `§d` | Light Purple (Pink) |
| `§e` | Yellow |
| `§f` | White |

### Making Messages Silent

`{   "flan.noPermissionSimple": " " }`

## Finding All Translation Keys

You can find all keys through:

-   The Flan GitHub repository
-   Inside the mod jar under `assets/flan/lang/en_us.json` (this might also be located inside your `server/config/flan` folder as an example.
-   Our complete reference datapack on GitHub

## Advanced Customization Examples

### Fantasy Theme

`{   "flan.noPermissionSimple": "§5§oThese lands are warded against you...",   "flan.inspectBlockOwner": "§6Lord of these lands: §e%1$s",   "flan.claimCreateSuccess": "§aYour territory has been claimed!",   "flan.noPermission": "§cThe protective barrier blocks your action",   "flan.resizeClaim": "§eExpanding your domain, mark the new boundary" }`

### Modern or Military Theme

`{   "flan.noPermissionSimple": "§cACCESS DENIED",   "flan.inspectBlockOwner": "§7[PROPERTY OF: §f%1$s§7]",   "flan.claimCreateSuccess": "§aSecure zone established",   "flan.noPermission": "§cUnauthorized action blocked",   "flan.adminMode": "§eOverride mode: %1$s" }`

### Minimal Theme

`{   "flan.noPermissionSimple": " ",   "flan.inspectBlockOwner": "%1$s",   "flan.claimCreateSuccess": "§aDone",   "flan.noPermission": "§cNo permission" }`

## Multi-Language Support

If you are not using an English translation, consider creating datapacks for other languages:

`data/flan/lang/ ├── en_us.json ├── es_es.json ├── fr_fr.json ├── de_de.json └── zh_cn.json`

## Download Datapack

**Don’t want to build this from scratch?** We’ve already created a complete, ready-to-use datapack with a mystical or arcane theme.

[Download Datapack](https://github.com/gbti-network/flan-overwrite-default-messages)

## Looking for a new SMP?

If you made it this far, we would love to invite you to our members only Minecraft SMP! Come play with other programmers and product developers on our anarchy server today. [Click here](https://gbti.network/membership) to become a network member.

Our SMP is family friendly and a great place to meet people and plan your next adventure. We hope to see you there!

## Check out our Fabric Mods!

Also check out our [Traveler’s Series Mods](https://modrinth.com/collection/Athgo1OS) on Modrinth.

## Looking for custom Minecraft development?

Our network connects Minecraft server administrators with [talented Minecraft developers](https://gbti.network/hire/minecraft-developers/).

Join [our network](https://gbti.network/membership) for help with your next big project. 🙏 Thanks for reading!

![The GBTI Network](https://secure.gravatar.com/avatar/6eb5fafe6db6be32b2df920c3763ba393c665a7da271c792b778d74504dc0a87?s=479&d=mm&r=g)

We hope you enjoyed this article by **The GBTI Network**, GBTI Member.

Follow us for more content like this.

-   [GitHub](https://github.com/gbti-network)
-   [X](https://x.com/gbti_network)
-   [YouTube](https://www.youtube.com/channel/UCh4FjB6r4oWQW-QFiwqv-UA)
-   [Dev.to](https://dev.to/gbti)
-   [Bluesky](https://bsky.app/profile/gbti.bsky.social)
