---
title: 'App Clips hand someone a working piece of your app before they ever install it'
slug: ios-app-clips-what-they-are-and-who-uses-them
status: draft
visibility: public
publicStub: false
excerpt: >-
  An App Clip runs part of an iOS app with no install, launched from a link, a QR code, or an NFC tag.
  Here is how it works, who is already using it, and where it might fit next.
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

We came across **App Clips** recently and realized how little we knew about them beyond the name. An App Clip runs part of an iOS app with no install: the person never visits the App Store, downloads anything, or creates an account. They do the one thing they came to do and move on, and the software removes itself later without being asked.

App Clips have existed since iOS 14 in 2020, and Apple is still adding to them, most recently in June 2025.[^1]

## How it works

An App Clip is an additional target inside the same Xcode project as the full app, rather than a separate SDK or framework, and it shares code with that app directly.[^8] The usual ways to keep that code shared: give individual files target membership in both, or put the shared logic in its own Swift package that both targets depend on. Copying files between the two works too, but is actively discouraged, because it is the fastest way for the clip and the full app to quietly drift apart.[^8]

That target compiles down to its own small binary, which is what makes an install unnecessary: instead of downloading the full app, the system fetches and runs just that binary for the length of the task, and removes it later.[^2][^5] The size ceiling exists for exactly this reason: everything the App Clip needs, code and assets both, has to fit inside that one download.

Security is not App Review at the moment someone taps a link. It is domain verification, done ahead of time. A developer adds the Associated Domains capability with an `appclips:<domain>` entry, then hosts a file named `apple-app-site-association` in a `.well-known` folder on that domain, declaring which App Clip is authorized to launch from it.[^9] The system checks that file before it will launch the clip at all, the same mechanism Universal Links use, extended with one more key. A link cannot stand in for someone else's App Clip without first controlling their domain.

Maintaining one is two ongoing obligations rather than a checklist finished once: keep the shared code, ideally the package, in sync as the full app changes, and keep the association file live and correct on your own server. If that file goes missing or gets misconfigured, the clip simply stops launching.

None of this is a way to avoid building the full app. Every App Clip has to ship inside one and include the same functionality it offers, so it is a way to give someone the useful part of an app before they commit to the rest.[^2] People reach a clip eight different ways, from a QR code or an NFC tag to a link shared in Messages.[^3] The number itself is less the point than the decision behind it: a project built around App Clips has to pick how many of those doors it wants open.

## How is it currently being used in the real world?

The public record here is thin, but named deployments exist, and they sort into three groups more useful than a list of logos.

### Physical taps and scans

What Apple advertised from day one. ExxonMobil put tap to pay at the pump in 2020, the Apple Store used a barcode scan in its own stores to pull up accessory details in 2021, and ParkWhiz put an NFC tag at the spot so someone could pay without installing anything.[^4][^6] Panera Bread sits just off to the side of this group: its ordering flow comes through Apple Maps rather than something you scan.[^4]

### Sent to someone who isn't the customer

The group worth stopping on, because nobody markets it. SignEasy lets someone sign a document that was sent to them, with no install required of the signer. Parcel tracks a single package from a shared link. Flash Note Cards makes and shares cards inside a conversation.[^6] None of those people are the customer. They were handed a thing and needed to deal with it, which is arguably the strongest argument for the whole feature, and it is not the one Apple leads with.

### Try before you commit

A single early example so far: Elloveo, a free trial of a children's science app.[^6] It is also the group Apple has invested in most recently, which is what the June 2025 demo work is for.

What every one of them shares, across all three groups, is a task that finishes in about a minute.

No source reports an install lift, a conversion rate, or a completion figure for any of them. We looked specifically for outcomes: a search for App Clip campaign results returns marketing case studies about other things entirely, and a search for App Clip business results returns mobile-ordering and micromobility material with no App Clips in it. We would rather report that absence than dress up unrelated statistics as evidence.

Both sources are dated: the Heady teardown is from March 2021 and the AppleInsider piece is from December 2022.[^6][^4] Nothing comparable has surfaced since.

## Where it might fit next

Picture the same shape wherever it lands next: a diner ordering without installing anything, a driver tapping to pay at the pump, someone trying one level of a game before deciding whether to buy the rest. An App Clip fits a task that small and that self-contained, on a website, at a location, or as a demo, and stops fitting the moment the task needs to remember who you are, run while nobody is looking, or outlast a minute.

## We have not shipped one

Nobody at GBTI Network has built an App Clip. Everything above comes from Apple's documentation and from published third-party accounts, cited as such, and none of it has been checked by us against something running in production. Treat it as a map, not a review.

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

[^8]: Apple, "Creating an App Clip with Xcode," Apple Developer Documentation, read August 10, 2026. Source of the target-based architecture and the shared-code guidance, including the recommendation against copying files directly: [developer.apple.com](https://developer.apple.com/documentation/appclip/creating-an-app-clip-with-xcode)

[^9]: Apple, "Supporting associated domains," Apple Developer Documentation, read August 10, 2026. Source of the `apple-app-site-association` file format and the `appclips` key that authorizes a domain to launch a given App Clip: [developer.apple.com](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
