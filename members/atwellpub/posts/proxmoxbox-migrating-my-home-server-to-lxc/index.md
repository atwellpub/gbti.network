---
type: post
title: "ProxMoxBox: Migrating My Home Server to LXC | GBTI"
slug: proxmoxbox-migrating-my-home-server-to-lxc
author: atwellpub
status: draft
visibility: public
publishedAt: 2026-08-15
excerpt: "A closet home server running a radio station and a camera system moves off Windows and WSL onto Proxmox VE, with each app in its own unprivileged LXC container and no open ports anywhere."
categories: ["devops", "tooling"]
tags: ["proxmox", "lxc", "tailscale", "self-hosting", "home-server", "wsl"]
---

I'm not unfamiliar with a home server. I've been sitting on an ASRock H110 Pro BTC+ since Ethereum
was POW (Proof of Work). For anyone curious, 4 1060 Zotecs managed to earn quite a bit of coin
before Ethereum moved to the POS (proof of stake model).

In 2026, however, GPU mining is out, and the home server in my closet has shamefully been running
Windows 10 with WSL (Windows Subsystem for Linux) managing my node servers.

12gb ram, 100gb SSD, 1TB external HD. i7-7700 CPU. 🤌 Getting the home server job done.

Times are changing though. Seemed like 40gb of that 100GB SSD goes to the Windows OS.
Cross-filesystem performance is known to struggle on WSL environments; sizes of volumes grow without
automated garbage collection and a tall list of inefficiencies all trying to have me admit the WSL
might never be the right choice for a home server that runs mostly standalone, linux apps.

One of those apps being my SavePoint Radio Station that I keep online for a discord community I
operate.

Or Starlight Surveillance, my most recent project aimed at helping me rid another subscription by
moving my camera footage off Google Cloud Storage and onto the hard drive.

There's also the pressure of creating a Linux container for an OpenClaw instance where I can run a
consort on affordable DeepSeek powered agents; like my colleagues are doing here on the GBTI
Network. <br><br>Who knows, maybe there will be a new reason to spin up those retired 1060 GPUs soon
too.

If that time comes, I want to be free from Windows running sublinux and just go ahead and move to an
OS that is designed to manage linux resources.

So this month I made the call to change my personal identity, format over Windows and install
Proxmox to be my new home server OS.

## Proxmox and the ProxMoxBox box

[Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment/overview) is a Debian-based
virtualization platform that manages both VMs and LXC containers behind one web interface. I am running
9.2.2, which sits on Debian 13.

The machine is now, unavoidably, the ProxMoxBox box. Say it three times fast. I will wait.

There is a genuine reason to pick Proxmox beyond the feature list, and it is the ecosystem. Home servers
have a large and active community of people solving the same problems, publishing helper scripts, and
answering questions from someone running exactly your hardware. That is worth a great deal when something
does not work at two in the morning.

## What LXC is, and how it differs from a virtual machine

A container and a virtual machine cost the machine very different amounts, and that decides how many
services fit on one box.

A virtual machine emulates a computer. It boots its own kernel, runs its own device drivers through
QEMU, and holds its own memory. When you give a VM 4 GB, that 4 GB is allocated to it and the host cannot
use it for anything else, whether the VM is busy or idle.

An LXC container shares the host's kernel. There is no guest kernel to boot, no QEMU, no virtio device
state. What you get instead is a set of isolated namespaces and cgroup limits around a normal Linux
process tree. In practice a bare Debian container idles at something like 30 to 60 MB of RAM before you
run anything, where the same services in a VM cost 200 to 400 MB just to exist. A container starts in
under a second. A VM takes 15 to 30 seconds to boot.

**Unprivileged** changes the blast radius. An unprivileged container maps its root user to an unprivileged
user on the host, so root inside the container is nobody in particular outside it. Both of mine are
unprivileged.

Separating the two applications was worth as much to me as the efficiency was. Under the old setup they
shared one Linux environment, which meant they shared their dependencies, their failure modes and their
fate: whatever took one down was liable to take the other with it. Now each application is its own
container, with its own packages, its own resource ceiling and its own restart. The radio can crash
without the cameras noticing. Proxmox also snapshots and backs up each container independently, on a
schedule, which replaces the previous arrangement of remembering to export the whole thing by hand and
usually not doing it.

Here is the part I originally described, incorrectly, as load balancing. Proxmox does not balance load
between containers. What actually happens is subtler and more useful: the `cores` setting is a ceiling,
not a reservation. I have allocated 10 cores across 8 threads, deliberately overlapping, because each
service can burst up to its ceiling whenever the other is idle. Container memory is elastic in the same
way, where VM memory is not without ballooning. On top of that, `cpuunits` gives the cameras priority over
the radio when both want the CPU at once.

Ceilings rather than reservations is what lets two services share 12 GB without either being starved,
which is not what "load balancing" describes.

## Reaching it: Tailscale, and what actually provides the security

Both services stay off the public internet entirely: no forwarded port on my router, no reverse proxy
with a certificate facing the world. Everything is reached over
[Tailscale](https://tailscale.com/), running 1.102.2 in both containers.

Tailscale builds a private mesh network between your own devices. Its MagicDNS feature gives each machine
a stable hostname on that network, so I reach the radio and the cameras by name rather than by chasing an
IP address that changes. Because every connection is initiated outbound from the device, it works
perfectly well from behind the NAT described earlier. NAT traversal is a convenience here, not a defence.

I want to be careful about that last point, because it is the sort of thing that gets stated loosely and
then repeated. Not exposing a port is real and worthwhile, but obscurity is not the security boundary
here. The tailnet access control list is. Only devices I have added to my network can reach these
services at all, and the ACL decides which of those devices may reach which service. That is a policy I
control and can audit, rather than a hope that nobody scans my address.

On cost: as of the pricing change in April 2026, Tailscale's free Personal plan covers up to 6 users with
unlimited devices, which is comfortably more than a household needs. Check the current terms before you
rely on that, since it changed once already this year.

There is one container-specific trap worth recording. Tailscale in an unprivileged LXC container needs
`/dev/net/tun` passed through explicitly. Containers do not get it by default, and without it the daemon
simply cannot build a tunnel. Separately, Debian ships `tailscaled` with `Restart=on-failure`. It exited
cleanly once with status 0, systemd counted that as success, and remote access stayed down for three
minutes. That is now `Restart=always`.

## Where it stands right now

I am writing this while the migration is still finishing, and I would rather say so than present a tidy
retrospective.

The Proxmox host is built. Both containers are built, configured and verified: the cold-start test passed,
with Wi-Fi associating on its own, storage mounting, both containers auto-starting and both services
answering. What remains is data. The media library is copying to the newly reformatted volume, after which
the media paths get repointed, both containers restart, and the radio gets a fresh deploy.

The concrete result, though, is already visible. Both containers running put the host at 2.0 GB used
with 9.4 GB available. The same two workloads as virtual machines would have consumed roughly 6 GB
before executing a single line of application code. On a 12 GB machine, that difference is the entire
reason this approach works.

<!-- SCREENSHOT PLACEHOLDER: SavePoint station in motion, streaming from the new host -->

<!-- SCREENSHOT PLACEHOLDER: the camera application in motion, both cameras live -->

## The two applications

[SavePoint](https://savepoint.fm) is an online radio management platform with multi-channel streaming to
Discord and YouTube. I build it, and I run a hobby station on it called TaverRX that plays role-playing
game soundtrack music. Running the station is genuinely how I find the rough edges in the platform, which
is a good argument for keeping it alive through a hardware migration rather than letting it stay dark.

The surveillance system is my own code, driving two Google Nest cameras through Google's Smart Device
Management API. A bridge process holds and extends the Nest sessions against a quota of 100 queries per
hour per camera, which is the sort of constraint that shapes an entire design once you hit it. Support for
Ring cameras is planned but not built.

That project is not open source yet. I intend to publish it this year, and I will update this article
with a link when it is available.

## What migration is actually good for

A migration is an excellent bug finder, because it forces every assumption into the open. This one
surfaced four latent faults in the camera project that had never been triggered: a recorder configured to
dial an RTSP port that nothing was listening on, systemd units bound to a service that had been replaced
and no longer existed, a restart-limit directive sitting in the wrong section where systemd ignores it
entirely, and a hardened unit with no write access to the directory it records footage into.

All four were waiting to be found. None was caused by the move.

---

If you self-host anything, the question worth asking is whether your services come back on their own
after the next power cut, not whether they are running today. Mine did not come back, and that is what
started this.

For more tutorials, AI skills and member-built products, have a look around
[GBTI Network](https://gbti.network/). We are a developer co-op, and this is the sort of thing we spend
our time on.
