---
type: post
title: "How to get a Telegram Bot Token - AndShare Tutorial"
slug: how-to-get-a-telegram-bot-token
author: gbti
status: published
visibility: public
publishedAt: 2023-09-02
updatedAt: 2023-10-04
excerpt: "Creating a Telegram bot and getting a bot token involves a few steps: Step 1: Talk to BotFather Step 2: Create a New Bot Step 3: Store the Token Note The token will look something like this: Replac…"
categories: ["gbti", "products", "andshare"]
layout: editorial
redirectFrom: ["/gbti/products/andshare/how-to-get-a-telegram-bot-token/"]
---

Creating a Telegram bot and getting a bot token involves a few steps:

### Step 1: Talk to BotFather

1.  Open your Telegram app, then search for the “BotFather” bot. The username is `@BotFather`.
2.  Start a chat with BotFather by clicking the “Start” button at the bottom of the screen.

### Step 2: Create a New Bot

1.  Type `/newbot` to create a new bot.
2.  BotFather will ask you for a name for your bot. Type the name and send it.
3.  Next, you’ll be asked to choose a username for your bot. This username must end in `bot`, like `examplebot` or `example_bot`.
4.  If all goes well, BotFather will congratulate you and provide you with a token.

### Step 3: Store the Token

-   After creating the bot, you’ll get a message that contains the token for the bot. Make sure to save this token securely as you’ll need it to interact with the Telegram API.

### Note

-   You’ll need to make your bot an admin in your Telegram channel or group to post messages, delete messages, etc.

The token will look something like this:

`110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`
Replace `<YOUR_BOT_TOKEN>` in the code with this token.

After these steps, you can use this token to perform operations as your bot, like sending messages, in the context of the Telegram API.

For more advanced features or for the official documentation, you can visit the [Telegram Bot API documentation](https://core.telegram.org/bots/api).
