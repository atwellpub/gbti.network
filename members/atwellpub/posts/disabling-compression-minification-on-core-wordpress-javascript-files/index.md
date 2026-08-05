---
type: post
title: "Disabling Minification on Core WordPress JavaScript Files | GBTI"
slug: disabling-compression-minification-on-core-wordpress-javascript-files
author: atwellpub
status: published
visibility: public
publishedAt: 2024-06-29
updatedAt: 2024-08-18
excerpt: "Learn how to disable minification of JavaScript files in the WordPress Admin Dashboard to facilitate easier debugging and customization."
categories: ["devops", "frameworks", "wordpress"]
layout: journal
coverImage: "./images/atwellpub_engineer_stuck_between_hydrolic_press_trying_to_push__4b1ae464-dd1c-4fbe-a670-a7617fdbf3ca.webp"
redirectFrom: ["/devops/frameworks/wordpress/disabling-compression-minification-on-core-wordpress-javascript-files/"]
---

Sometimes, it becomes necessary to edit core WordPress files directly, inside a non production environment, to better understand the behavior of the WordPress platform and pinpoint specific problems. By default, WordPress combines and compresses its JavaScript files to improve performance, but this can make it difficult to trace issues or make modifications.

This tutorial will guide you through the steps to disable these features, allowing you to work with the original, unminified files.

## Editing wp-config.php directly to disable minification.

To disable script concatenation and compression, add the following lines to the `wp-config.php` file:

`define('CONCATENATE_SCRIPTS', false); define('SCRIPT_DEBUG', true);`
## Editing functions.php directly to disable minifications.

To disable script minification and concatenation via your theme’s `functions.php` file, add the following code:

`add_filter('script_loader_src', 'disable_minification', 10, 2); add_filter('style_loader_src', 'disable_minification', 10, 2);  function disable_minification($src, $handle) {     if (strpos($src, '.min.') !== false) {         $src = str_replace('.min.', '.', $src);     }     return $src; }`
## Additional considerations

Direct modification of core WordPress files is generally discouraged due to the following reasons:

-   Changes will be overwritten during updates.
-   It may lead to unexpected behavior if not executed properly.

Preferably, use hooks, filters, or plugins to implement changes. For those needing to directly edit JavaScript files, creating a custom plugin or theme to include the custom scripts is advised.
