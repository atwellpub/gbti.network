---
title: 'App Clips let a website hand someone a piece of an app, and almost nobody is using them'
slug: ios-app-clips-what-they-are-and-who-uses-them
status: draft
visibility: public
publicStub: false
excerpt: >-
  An App Clip runs part of an iOS app with no install, launched from a link, a QR code, or an NFC tag.
  The technology works and Apple is still shipping updates. The adoption story is the harder part.
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

Someone taps a link on your site, and instead of a page telling them to install your app, part of your app opens. No App Store visit, no download, no account. They do the one thing they came to do and move on, and the software removes itself later without being asked.

That is an App Clip, and it has existed since iOS 14 in 2020. Apple is still adding to it: the most recent notable change in the official changelog is dated June 2025.[^1] What has not happened, in six years, is adoption. That gap is the interesting part of this piece.

## What an App Clip actually is

A lightweight build of an existing app, offering a slice of its functionality. Apple's own example is a donut shop, where the full app handles favorites, rewards, and offers, and the App Clip does one thing: order a donut.[^5]

Three properties do most of the work. It launches without an install. It never appears on the Home screen, so nobody manages it or cleans it up. And the system deletes it after a period of inactivity.[^5] The last one matters more than it sounds, because it removes the calculation a person makes before installing anything, which is whether this is worth permanent space on their phone.

An App Clip cannot exist on its own. It ships as a target inside a full app, and the full app has to include the same functionality the clip offers.[^2] So this is not a way to avoid building an app. It is a way to give someone the useful part of one before they commit.

## How someone gets into one

Apple lists eight invocations.[^3] They fall into two groups, and the split turns out to matter for what you can build.

Physical: scanning an App Clip Code, an NFC tag, or a QR code at a location. Digital: a location-based Siri suggestion, a link in Maps, a Smart App Banner in Safari, the action button on an App Clip card in Safari, a link shared in Messages as a text message, a link in an email or on a web page, and, since iOS 17, an App Clip preview inside another app.

Whichever route someone takes, the system checks the invocation URL against what is registered in App Store Connect, then uses that URL to pick which experience to launch and what to show on the App Clip card.[^3]

One detail worth knowing before you design anything: once the person installs the full app, the full app replaces the clip permanently. Every invocation from that point launches the app, so the app has to handle every URL the clip handled.[^3]

## The size limit, and the trade it forces

The ceiling has moved twice.[^2]

| iOS version | Maximum uncompressed App Clip binary |
|---|---|
| iOS 15 and earlier | 10 MB |
| iOS 16 and earlier | 15 MB |
| iOS 17 and later | 100 MB, with conditions |

The conditions are the part to read carefully. The 100 MB ceiling applies only if the App Clip supports digital invocations exclusively, drops physical ones entirely, expects a reliable connection, and abandons iOS 16 and earlier.[^2] In other words, the generous limit and the QR code on a table are mutually exclusive by default.

There is one exception. The demo link that App Store Connect generates gets 100 MB and keeps physical invocations,[^2] which is aimed at the case Apple added in June 2025: shipping a demo version of an app or a game as an App Clip, so someone can play the first level or take one workout before buying.[^1]

## What you give up

The constraint list is long, and reading it is the fastest way to judge whether an idea fits.

A set of frameworks compile but return nothing useful at runtime, including HealthKit, PhotoKit, Contacts, EventKit, Core Motion, Media Player, Speech, and App Intents.[^2] Apple's example is that HealthKit's `isHealthDataAvailable()` simply returns false inside a clip.

Background activity is out altogether: no background networking, no Background Modes, no holding a Bluetooth connection while the clip is not in front of the user.[^2] Face ID is unavailable because the usage-description entitlement is not offered to clips, though Touch ID through Local Authentication works.[^2] CloudKit was unavailable in iOS 14 and 15, and since iOS 16 a clip can read its public database but cannot write to it or touch private and shared containers.[^2]

The privacy limits are the ones that explain the adoption problem better than anything else. SKAdNetwork is unavailable. A clip cannot request App Tracking Transparency authorization. Both `name` and `identifierForVendor` return an empty string. Continuous location access cannot be requested, and the when-in-use permission a clip does get resets automatically at four the next morning.[^2]

Read that list as a business rather than as a developer. An App Clip is deliberately built so that you learn almost nothing about the person using it.

## So who is actually using them

This is the question worth asking, and the honest answer is that the public record is thin.

Named deployments do exist, and they sort into three groups that are more revealing than a list of logos.

The physical ones are what Apple advertised. ExxonMobil put tap to pay at the pump in 2020, the Apple Store used a barcode scan in its own stores to pull up accessory details in 2021, and ParkWhiz put an NFC tag at the parking spot so somebody can pay for it without installing anything.[^4][^6] Panera Bread sits just off to the side of that group, because its ordering flow is reached through Apple Maps rather than through something you scan.[^4]

The second group is the one worth stopping on, because nobody markets it. SignEasy lets a person sign a document that was sent to them, with no install required of the signer. Parcel tracks a single package from a link somebody shared. Flash Note Cards makes and shares cards inside a conversation.[^6] In all three the App Clip lands in front of somebody who is not the customer and has no reason to want the app. They were sent a thing and they need to deal with it. That is arguably the strongest argument for the entire feature, and it is not the in-store retail argument Apple leads with.

The third group is a single early example, Elloveo, offering a free trial of a children's science app.[^6] It is also the group Apple has invested in most recently, which is what the June 2025 demo work is for.[^1]

What every one of them has in common is a task that finishes in about a minute.

**What is missing from every one of those sources is a number.** No install lift, no conversion rate, no completion figure, from any of them. We went looking specifically for outcomes and did not find them: a search for App Clip campaign results returns app-marketing case studies about other things entirely, and a search for App Clip business results returns mobile-ordering and micromobility material with no App Clips in it. The absence is the finding. We would rather say so than dress up unrelated statistics as evidence.

Dates are the other thing to notice. The teardown collection above is from March 2021 and the assessment below is from December 2022.[^6][^4] We did not find a comparable piece written since.

The most direct explanation on the record is from a 2022 assessment: the feature launched in the middle of a pandemic, when a technology built for standing in front of a physical thing had nobody standing in front of physical things. Apple's Wiley Hodges is quoted describing early developer interest evaporating, with developers saying they were waiting because "it turns out everybody is inside now."[^4] The same piece argues the deeper problem is an incentive mismatch: users get speed, less clutter, and less data collection, while the developer gives up the install, the engagement, and the data.[^4]

That analysis is now several years old, and Apple has clearly not abandoned the feature. But the changelog is the tell. The most recent notable entry is June 2025,[^1] and it is about demo versions rather than the in-the-moment retail use the feature was built for.

## Where it seems worth a look

Three situations survive the constraints.

A physical location with a task attached, where the person is present, holding a phone, and wants one thing finished. Ordering at a table, paying at a pump, unlocking a scooter. The constraints cost you little because the interaction is over in a minute.

A demo, which is the case Apple invested in most recently. The 100 MB ceiling plus a generated demo link that keeps physical invocations[^1][^2] is a real answer to the problem of asking somebody to install a game before knowing whether they like it.

A website with a genuinely mobile task, which is where this started for us. The Smart App Banner and the App Clip card in Safari are digital invocations, so the 100 MB ceiling is available if you are willing to require iOS 17 and skip QR codes.

Where it looks like a poor fit: anything needing identity, anything that has to run in the background, anything measured through attribution, and anything where the task is long enough that installing is not really an imposition.

## We have not shipped one

Nobody at GBTI Network has built an App Clip. Everything above comes from Apple's documentation and from published third-party accounts, cited as such, and none of it has been verified against a real deployment by us. Treat it as a map, not a review.

That is exactly where we would like to hear from members. If you have shipped an App Clip, or scoped one and decided against it, the specifics are what documentation never captures: what the App Store Connect configuration was actually like, whether people found the thing at all, whether it moved installs or replaced them, and what you would not do again. A report that it was not worth it is as useful as one that it was.

Leave a comment, or bring it to Discord if it turns into a longer conversation.

Cover photograph by iam hogir on Pexels.[^7]

[^1]: Apple, "App Clips updates," Apple Developer Documentation, read August 10, 2026. The June 2025 entry covers demo App Clips, the autogenerated demo URL, and Background Assets: [developer.apple.com](https://developer.apple.com/documentation/updates/appclips)

[^2]: Apple, "Choosing the right functionality for your App Clip," Apple Developer Documentation, read August 10, 2026. Source of the size table, the unavailable-framework list, the background and privacy limits, and the CloudKit and Face ID restrictions: [developer.apple.com](https://developer.apple.com/documentation/appclip/choosing-the-right-functionality-for-your-app-clip)

[^3]: Apple, "Configuring App Clip experiences," Apple Developer Documentation, read August 10, 2026. Source of the eight invocations and the full-app replacement rule: [developer.apple.com](https://developer.apple.com/documentation/appclip/configuring-the-launch-experience-of-your-app-clip)

[^4]: William Gallagher, "What happened to Apple's App Clips," AppleInsider, December 11, 2022. Source of the ExxonMobil, Apple Store, Panera Bread and Starbucks examples, the Wiley Hodges quotation, and the incentive-mismatch argument: [appleinsider.com](https://appleinsider.com/articles/22/12/11/what-happened-to-apples-app-clips)

[^5]: Apple, "App Clips," Apple Developer Documentation, read August 10, 2026. Source of the donut shop example and the inactivity-removal behavior: [developer.apple.com](https://developer.apple.com/documentation/appclip)

[^6]: Heady, "The App Clips Playbook: 5 Inspiring Examples and Teardowns," March 17, 2021. Source of the ParkWhiz, SignEasy, Parcel, Elloveo and Flash Note Cards examples. Notably it reports no outcome figures for any of them: [heady.io](https://www.heady.io/blog/the-app-clips-playbook-5-inspiring-examples-teardowns)

[^7]: Cover photograph by iam hogir on Pexels, used under the [Pexels License](https://www.pexels.com/license/): [pexels.com/photo/17744145](https://www.pexels.com/photo/a-man-sitting-at-the-desk-and-using-a-laptop-and-smartphone-17744145/)
