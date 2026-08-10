---
title: 'App Clips hand someone a working piece of your app before they ever install it'
slug: ios-app-clips-what-they-are-and-who-uses-them
status: draft
visibility: public
publicStub: false
excerpt: >-
  An App Clip runs part of an iOS app with no install, launched from a link, a QR code, or an NFC tag.
  The technology works. Whether it fits your next project, and who has shipped one, are the
  harder questions.
categories:
  - design
  - ui-ux
tags:
  - ios
  - mobile
  - app-clips
  - apple
layout: journal
coverImage: "./images/laptop-and-smartphone.webp"
coverAlt: A person holding a smartphone in one hand with a laptop open in front of them
featured: false
type: post
author: gbtilabs
---

Someone taps a link on your site, and instead of a page telling them to install your app, part of your app opens. They never visit the App Store, download anything, or create an account. They do the one thing they came to do and move on, and the software removes itself later without being asked.

That is an **App Clip**, and it has existed since iOS 14 in 2020. Apple is still adding to it, most recently in June 2025.[^1]

## What an App Clip is

A lightweight build of an existing app, offering a slice of its functionality. Apple's own example is a donut shop: the full app handles favorites, rewards, and offers, and the App Clip does one thing, order a donut.[^5]

Three properties do the real work. It launches without an install. It never appears on the Home screen, so nobody manages it or cleans it up. The system deletes it after a period of inactivity, which erases the one calculation a person makes before installing anything: is this worth permanent space on my phone.[^5]

It ships as a target inside a full app rather than standing alone, and the full app has to include the same functionality the clip offers.[^2] So this is not a way to avoid building an app. It is a way to give someone the useful part of one before they commit. People reach a clip eight different ways, from a QR code or an NFC tag to a link shared in Messages.[^3] The count is less about the feature than about how many doors your project would need to open at once.

## Where an App Clip fits your next integration

Three situations hold up once you look past the pitch.

A physical location with one task attached, where somebody is standing there with a phone and wants exactly one thing finished: ordering at a table, paying at a pump, unlocking a scooter. The constraints barely register, because the interaction is over in a minute anyway.

A demo. Apple's newest push, since June 2025, is a generated demo link that gets a 100 MB budget and keeps physical invocations, aimed squarely at letting someone try a level or a workout before buying.[^1][^2] If the pitch is "try it first," this is a real answer.

A website with a task that is genuinely mobile. A Smart App Banner or an App Clip card in Safari can launch one, and the 100 MB ceiling is available if the project can live with iOS 17 and skip QR codes entirely.[^2]

Outside those three, the constraint list gets expensive fast. No background activity of any kind. No App Tracking Transparency, no SKAdNetwork, and the two identifiers a clip could otherwise read both return empty.[^2] The when-in-use location permission a clip does get resets on its own every night at four in the morning.[^2] Read that list as a business decision rather than a developer one: an App Clip is built so you learn almost nothing about the person using it, on purpose.

If the project needs identity, needs to run in the background, needs attribution, or the task is long enough that installing was never really the imposition, an App Clip is the wrong shape for it.

## Who has shipped one

The public record here is thin, but named deployments exist, and they sort into three groups more useful than a list of logos.

The physical ones are what Apple advertised from day one. ExxonMobil put tap to pay at the pump in 2020, the Apple Store used a barcode scan in its own stores to pull up accessory details in 2021, and ParkWhiz put an NFC tag at the spot so someone could pay without installing anything.[^4][^6] Panera Bread sits just off to the side of that group: its ordering flow comes through Apple Maps rather than something you scan.[^4]

The second group is the one worth stopping on, because nobody markets it. SignEasy lets someone sign a document that was sent to them, with no install required of the signer. Parcel tracks a single package from a shared link. Flash Note Cards makes and shares cards inside a conversation.[^6] None of those people are the customer. They were handed a thing and needed to deal with it, which is arguably the strongest argument for the whole feature, and it is not the one Apple leads with.

The third group is a single early example: Elloveo, a free trial of a children's science app.[^6] It is also the group Apple has invested in most recently, which is what the June 2025 demo work is for.

What every one of them shares is a task that finishes in about a minute.

No source reports an install lift, a conversion rate, or a completion figure for any of them. We looked specifically for outcomes: a search for App Clip campaign results returns marketing case studies about other things entirely, and a search for App Clip business results returns mobile-ordering and micromobility material with no App Clips in it. We would rather report that absence than dress up unrelated statistics as evidence.

Both sources are dated: the Heady teardown is from March 2021 and the AppleInsider piece is from December 2022.[^6][^4] Nothing comparable has surfaced since, which is itself worth knowing if you go looking for more.

## We have not shipped one

Nobody at GBTI Network has built an App Clip. Everything above comes from Apple's documentation and from published third-party accounts, cited as such, and none of it has been checked against a real deployment by us. Treat it as a map, not a review.

That is exactly where members come in. If you have shipped an App Clip, or scoped one and decided against it, tell us the part documentation never captures: what App Store Connect was like, whether people found the thing, whether it moved installs or replaced them, and what you would not do again. A report that it was not worth it is as useful as one that it was.

Leave a comment, or bring it to Discord if it turns into a longer conversation.

Cover photograph by iam hogir on Pexels.[^7]

[^1]: Apple, "App Clips updates," Apple Developer Documentation, read August 10, 2026. The June 2025 entry covers demo App Clips, the autogenerated demo URL, and Background Assets: [developer.apple.com](https://developer.apple.com/documentation/updates/appclips)

[^2]: Apple, "Choosing the right functionality for your App Clip," Apple Developer Documentation, read August 10, 2026. Source of the size ceiling, the demo-link conditions, and the background and privacy limits: [developer.apple.com](https://developer.apple.com/documentation/appclip/choosing-the-right-functionality-for-your-app-clip)

[^3]: Apple, "Configuring App Clip experiences," Apple Developer Documentation, read August 10, 2026. Source of the eight invocation methods: [developer.apple.com](https://developer.apple.com/documentation/appclip/configuring-the-launch-experience-of-your-app-clip)

[^4]: William Gallagher, "What happened to Apple's App Clips," AppleInsider, December 11, 2022. Source of the ExxonMobil, Apple Store, and Panera Bread examples: [appleinsider.com](https://appleinsider.com/articles/22/12/11/what-happened-to-apples-app-clips)

[^5]: Apple, "App Clips," Apple Developer Documentation, read August 10, 2026. Source of the donut shop example and the inactivity-removal behavior: [developer.apple.com](https://developer.apple.com/documentation/appclip)

[^6]: Heady, "The App Clips Playbook: 5 Inspiring Examples and Teardowns," March 17, 2021. Source of the ParkWhiz, SignEasy, Parcel, Elloveo, and Flash Note Cards examples. Notably it reports no outcome figures for any of them: [heady.io](https://www.heady.io/blog/the-app-clips-playbook-5-inspiring-examples-teardowns)

[^7]: Cover photograph by iam hogir on Pexels, used under the [Pexels License](https://www.pexels.com/license/): [pexels.com/photo/17744145](https://www.pexels.com/photo/a-man-sitting-at-the-desk-and-using-a-laptop-and-smartphone-17744145/)
