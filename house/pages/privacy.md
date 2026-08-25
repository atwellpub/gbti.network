---
type: page
title: "Privacy Policy"
slug: privacy
status: published
visibility: public
description: "How the GBTI Network collects, uses, and protects your data. Covers the public content repository, the membership registry (Stripe), the weekly email digest, the processors we rely on, your rights including erasure, and the honest limits of deleting content from a public repository."
updatedAt: 2026-08-25
redirectFrom: ["/privacy/"]
---

# Privacy Policy

_Last updated: August 25th 2026_

## 1. Who we are

The GBTI Network is operated by **Gethsemane LLC** ("GBTI", "we", "our", or "us"), a United States limited liability company. For the personal data described here, Gethsemane LLC is the data controller. If you have a question about your data, email us at [opportunities+contact@gbti.network](mailto:opportunities+contact@gbti.network) or [contact us](/contact/).

## 2. The public content repository (please read this first)

The GBTI Network's website is published from a public Git repository, and that repository is the system of record for member content. This shapes almost everything below.

- Content you choose to publish (your member profile, articles, products, prompts, and comments) is committed to a public repository and is visible to anyone.
- Because the repository is public, copies can be made outside our control: it can be forked on GitHub, cached by content delivery networks such as jsDelivr, and captured by web archives.
- When you ask us to remove published content, we remove it from our canonical repository and rebuild the site, but we cannot guarantee removal from third-party forks, caches, or archives. Publishing to a public repository is, in this sense, irreversible.
- Member-only content is encrypted before it is committed, and the decryption key never leaves our server. We rotate that key on a schedule, which makes older encrypted content in the repository history unreadable over time. This is strong protection for perks, not a guarantee of absolute secrecy.

## 3. What we collect, and where it lives

We practice data minimization. We do not store payment details on our own systems. There is one place we store an email address, the newsletter described below, and there it is encrypted at rest and never held in readable form.

- **Identity.** When you sign in with GitHub, we record your immutable GitHub user id and login. If you connect Discord, we record your Discord user id. If you set a profile avatar, we store a one-way Gravatar hash, not your email address.
- **Newsletter.** If you subscribe to the weekly digest, we store a record for you at the network edge. What it contains depends on how you joined, and the detail is in "The newsletter" below.
- **Membership and billing.** Our payment processor, Stripe, holds your email address and billing details and acts as the registry of your membership status. We read your status from Stripe; we do not store card data.
- **Published content.** Your profile, articles, products, prompts, and comments live in the public repository, by your choice to publish them.
- **Activity data.** Your private bookmarks (favorites) and collections are stored in a separate, deletable store at the network edge, keyed to your GitHub id. They are private to you and are not published to the repository.
- **Operational data.** Our infrastructure provider, Cloudflare, processes technical request data such as IP addresses for security and reliability, and we use Cloudflare Turnstile to deter automated abuse at sign-up.

### The browser extension

The optional GBTI Network browser extension lets members author and read their gbti.network content in place. It is a single-purpose tool, and its data handling is limited to that purpose.

- **What it stores, and where.** The extension stores on your own device, in the browser extension's local storage, your GitHub access token and refresh token, your cached membership status, and your interface preferences. This data stays on your device. It is not sent to us or to any third party.
- **Token isolation.** Your GitHub access token is held only by the extension's background service worker. It is never exposed to any web page, including gbti.network itself.
- **What it accesses, and why.** To sign you in, the extension uses GitHub's device authorization flow at github.com and reads your membership status from our sign-up service. To let you author and read member content, it reads from and writes to the public content repository through the GitHub API. It communicates only with gbti.network, our sign-up service at signup.gbti.network, and GitHub.
- **No tracking, no browsing collection.** The extension contains no analytics or tracking code. Its content script runs only on gbti.network pages; it does not read or record your activity on any other website, and it collects no web browsing activity.
- **Use limitation.** Extension data is used solely to provide the extension's single purpose: authentication, and authoring and reading your gbti.network member content. We do not sell it, transfer it to third parties, or use it for advertising or any unrelated purpose.
- **Removing it.** Uninstalling or disabling the extension removes its locally stored data from your device. You can revoke the extension's access to your GitHub account at any time at github.com/settings/applications.

### The newsletter

We publish a weekly digest by email. There are two ways an address ends up on it, they have different lawful bases, and they store different things.

- **If you are a member, we enrolled you without asking.** The digest is how the co-op tells its own members what happened that week, so we treat it as part of the membership rather than as marketing. Our lawful basis is our legitimate interest in keeping members informed about the network they belong to. **Your subscriber record holds no email address at all.** It holds your GitHub user id, and your address is read from Stripe at the moment an issue is sent and is not retained afterwards. You can unsubscribe at any time, from any issue, and remain a member.
- **If you are a visitor who submitted the form, we asked first and waited.** Our lawful basis is your consent. Submitting the form does not subscribe you: we write a pending record that expires after 48 hours and send you one confirmation email. **You are not a recipient until you click the link in it**, so an address typed in by somebody else is never enrolled. That confirmation email is the only message we send before you confirm, and if you never confirm, the pending record expires and nothing remains.

**What we store, and how.** Your address is encrypted before it is written, under a key bound to that specific address, and no part of the system stores it in readable form. Every other record about you is keyed to a one-way hash of your address rather than to the address itself.

**What we deliberately do not do.** We do not track opens: there is no tracking pixel in any issue, and we have not enabled our email provider's open or click tracking. We do count how many times each link in an issue was clicked, so we can tell which sections are worth keeping, but that counter records nothing about the reader. Not your address, not a hash of it, not your IP, not your browser. It can answer "how many people clicked this link" and it is structurally unable to answer "did this person click".

**Unsubscribing, and what survives it.** Every issue carries an unsubscribe link. When you use it we record that your address has opted out, and **that opt-out record deliberately outlives everything else, including a full erasure request.** It has to: it is a one-way hash with no address in it, and it is the only thing that stops a future import or a well-meant edit from adding you back. If you ask us to erase your data, we delete your subscriber record and keep the opt-out, so the result is that we hold nothing about you except the fact that you asked not to be contacted. We also do not re-subscribe an address that has previously opted out, even if the form is submitted again.

## 4. How we use your data, and our lawful bases

- To provide the service you signed up for: authentication, publishing, membership, billing, role assignment, and community access. Our lawful basis is performance of our contract with you.
- To keep the service secure: anti-abuse checks, access controls, and logging. Our lawful basis is our legitimate interest in protecting the network.
- To send the weekly digest: our lawful basis is our legitimate interest in keeping members informed for members we enrolled, and your consent for visitors who subscribed through the form. Either way you can unsubscribe from any issue.
- To run the referral and attribution program: when you arrive through a member's invite link, we set a first-party cookie that records only the referrer or invite id, so that member is credited if you join later. Separately, so that we can fairly credit the members whose content brought you here, we record which member-owned content you view before you sign up. We keep that record in a deletable store at the network edge, keyed to a rotating session id, for up to a 90-day window, and we link it to your account only if you convert to a member. Until you convert, this record is not tied to your identity. Our lawful basis is our legitimate interest in operating the referral and content-attribution program. You can clear the cookie at any time in your browser, and you can ask us to erase the attribution record at any time.
- To understand and improve the site: privacy-respecting, cookieless analytics (Cloudflare Web Analytics). It sets no cookies and stores no cross-site identifier, so it needs no consent banner. Our lawful basis is our legitimate interest in understanding aggregate traffic to improve the co-op.

We do not use advertising cookies, we do not sell your data, and we do not profile you to make decisions that produce legal effects.

## 5. Cookies

One referral and attribution cookie, plus a sign-in session cookie that is strictly necessary to keep you logged in. Our analytics is cookieless and sets no cookie at all:

- **Referral and attribution (always set, for crediting members):** a first-party, essential cookie that holds a rotating session id, plus a referrer or invite id when you arrive through a member's invite link. It is what lets us credit the member whose link or content brought you in if you later join. This cookie is essential to the referral and attribution program, so it is set for all visitors, including those in the EU, the EEA, and the UK, and is not placed behind the analytics consent gate. It carries no profile of you. You can clear it at any time in your browser settings.
- **Pre-signup content attribution (deletable edge record):** so that we can fairly credit the members whose content brought you to the network, we record which member-owned content you view before you sign up. We keep that record at the network edge, keyed to the rotating session id above, for up to a 90-day window. It is not linked to your identity unless and until you convert to a member, and you can ask us to erase it at any time. This is broader than a single referral cookie, so we disclose it here plainly. Our lawful basis is our legitimate interest in fairly crediting contributing members.
- **Analytics (cookieless):** we use Cloudflare Web Analytics, which is privacy-respecting and sets NO cookie and no cross-site identifier, so there is nothing here to consent to. We do not use advertising or cross-site tracking cookies. (The EU/EEA/UK consent banner remains in place should we ever add a cookie-based analytics product.)

## 6. Who we share data with

We do not sell your personal data, and we do not share it with third parties for their own marketing.

We rely on a small number of service providers (processors), each under a data processing agreement:

- **GitHub** hosts the public repository and provides sign-in.
- **Stripe** processes payments and holds the membership registry.
- **Cloudflare** hosts the site and the edge services, and provides Turnstile.
- **Discord** hosts the community and holds community messages.
- **Resend** sends transactional email when email is used.

Some of these providers are based in the United States. Where personal data is transferred internationally, the transfer relies on appropriate safeguards such as Standard Contractual Clauses or the EU-US Data Privacy Framework.

## 7. Your rights

Depending on where you live, you may have the right to access your data, correct it, delete it, receive a portable copy, restrict or object to certain processing, and withdraw consent. To exercise any of these, please [contact us](/contact/).

- **Access and portability.** Much of your data is already portable: your published content is plain Markdown in your own folder in the repository.
- **Erasure.** We will remove your content from our canonical repository, hard-delete your activity data (favorites and collections) and any pre-signup content-attribution record from the edge store, delete your newsletter subscriber record, rotate the key that protects your encrypted member-only content, and remove your membership records from Stripe and your community roles from Discord. As described under "The newsletter", an unsubscribe record is kept on purpose, because deleting it would let a later import contact you again. As explained in section 2, we cannot guarantee removal from third-party forks, caches, or archives of the public repository.
- **Complaints.** If you are in the EU, the UK, or another region with a supervisory authority, you have the right to lodge a complaint with it.

## 8. Data retention

We keep membership records for the life of your membership and for any period required by tax or accounting law, then delete or anonymize them. Activity data is kept until you remove it or close your account. Backups of the edge store will be encrypted and kept for a bounded period. A newsletter subscriber record is kept until you unsubscribe or ask us to erase it. An unconfirmed newsletter sign-up expires by itself after 48 hours. An unsubscribe record is kept indefinitely, by design, so that your opt-out cannot be undone by accident.

## 9. Security

We encrypt member-only content, store a one-way hash rather than your email, derive membership status rather than warehousing it, and fail closed on access checks so that an error never grants access it should not. No method of storage or transmission is perfectly secure, but we take reasonable measures to protect your data.

## 10. Children

The service requires a GitHub account and is intended for adults and for users old enough to consent under their local law. It is not directed to children under 16.

## 11. Changes to this policy

We may update this policy from time to time. When we do, we will revise the "Last updated" date above and, for material changes, take reasonable steps to notify members.

## 12. Contact us

Questions about this policy or your data can be sent through our [contact page](/contact/).
