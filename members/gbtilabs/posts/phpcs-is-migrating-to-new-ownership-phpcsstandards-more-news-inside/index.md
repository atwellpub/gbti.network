---
type: post
title: "PHPCS is migrating to new ownership"
slug: phpcs-is-migrating-to-new-ownership-phpcsstandards-more-news-inside
author: gbtilabs
status: published
visibility: public
publishedAt: 2023-12-02
updatedAt: 2024-06-29
excerpt: "GBTI highlights PHP_CodeSniffer's move to PHPCSStandards, discussing its effect on WordPress, Drupal, and the challenges in repository migration and funding. Key insights into PHP's coding standard…"
categories: ["devops"]
layout: journal
coverImage: "./images/PHPCS-5.webp"
redirectFrom: ["/devops/phpcs-is-migrating-to-new-ownership-phpcsstandards-more-news-inside/"]
---

PHP\_CodeSniffer, an essential tool in the PHP community for ensuring code quality and adherence to coding standards, is undergoing a [significant transformation](https://github.com/squizlabs/PHP_CodeSniffer/issues/3932).

PHP\_CodeSniffer is being moved from the [squizlabs](https://github.com/squizlabs/) repository to the [PHPCSStandards](https://github.com/PHPCSStandards/PHP_CodeSniffer) organization. This decision came after challenges in collaboration and maintenance of the original repository​[](https://github.com/squizlabs/PHP_CodeSniffer/issues/3932)​.

## PHPCS is widely used.

Here are some noteable organizations that leverage the PHPCS technology:

1.  **WordPress**: Implements PHP\_CodeSniffer to enforce its specific [coding standards](https://github.com/WordPress/WordPress-Coding-Standards), ensuring consistency and quality across WordPress codebases​[](https://github.com/WordPress/WordPress-Coding-Standards#:~:text=This%20project%20is%20a%20collection,org%E3%80%91)​.
2.  **MediaWiki**: Their manual mentions the use of PHP\_CodeSniffer with a custom ruleset for MediaWiki to enforce coding standards [MediaWiki Documentation](https://www.mediawiki.org/wiki/Manual:Coding_conventions/PHP)​[](https://www.mediawiki.org/wiki/Manual:Coding_conventions/PHP#:~:text=Most%20of%20the%20code%20style,98%E2%80%A0%20%E3%80%91)​.
3.  **Drupal**: Drupal’s official Coder Sniffer install guide recommends installing Coder and the Drupal code sniffs globally using Composer, which includes PHP\_CodeSniffer [Jeff Geerling’s Guide](https://www.jeffgeerling.com/blog/2020/install-drupal-coder-and-php-codesniffer-your-drupal-project-lint-php-code)​[](https://www.jeffgeerling.com/blog/2020/install-drupal-coder-and-php-codesniffer-your-drupal-project-lint-php-code)​.
4.  **Joomla**: Joomla has a custom coding standard for PHP\_CodeSniffer to enforce its coding standards [Joomla Documentation](https://docs.joomla.org/Joomla_CodeSniffer)​[](https://docs.joomla.org/Joomla_CodeSniffer/en)​.
5.  **Magento**: Magento’s developer documentation recommends the use of PHP\_CodeSniffer, mentioning that PHP\_CodeSniffer 1.4.0+ includes PSR-1 and PSR-2 standards, which are followed by Magento 2 [Magento Developer Documentation](https://commerce-docs.github.io/m2/developer-guide/quality-tools/code-sniffers.html)​[](https://commerce-docs.github.io/devdocs-archive/2.0/guides/v2.0/coding-standards/code-standard-sniffers.html)​.
6.  **Symfony**: There’s a development repository for the Symfony coding standard, which includes instructions for installing a coding standard for PHP\_CodeSniffer [Symfony Coding Standard Repository](https://github.com/djoos/Symfony-coding-standard)​[](https://github.com/djoos/Symfony-coding-standard#:~:text=,org%E3%80%91%20dependency%20manager)​.

## We can imagine there will be some challenges:

1.  **Repository Transfer Issues**: The decline to transfer the repository from Squizlabs to PHPCSStandards due to code ownership concerns necessitated forking the repository, leading to several complications​[](https://github.com/squizlabs/PHP_CodeSniffer/issues/3932)​.
2.  **Loss of Historical Data**: Transitioning to a new repository means losing prior pull requests, issues, and wiki content, posing continuity challenges​[](https://github.com/squizlabs/PHP_CodeSniffer/issues/3932)​.

## Funding and maintenance:

1.  **Future Developments and Funding Needs**: The new version 4.0 is on the horizon, with efforts to automate the release process. However, the project requires [funding](https://github.com/sponsors/phpcsstandards) to continue its development and maintain a pool of maintainers​[](https://github.com/squizlabs/PHP_CodeSniffer/issues/3932)​.

Here at the GBTI syndicate we wish this project transition all success. We really liked their funding model as well. It would also be nice if big package donors could be prominently featured in the readme.md.

## Final thoughts.

The migration of PHP\_CodeSniffer to the PHPCSStandards organization marks a crucial phase in its lifecycle.

There are plenty of projects that will be slow to transition, but many organizations will most likely begin to transition as the PHPCSStandards group builds their community.

The continued support and collaboration from major organizations and the broader PHP community will be pivotal in navigating this change, ensuring PHP\_CodeSniffer remains a cornerstone in maintaining high coding standards in the PHP ecosystem.
