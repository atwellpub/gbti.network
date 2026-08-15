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

A power cut took my radio station down and nothing brought it back. It sat dead until I noticed, which
was not the same day.

That is the honest reason this migration happened. The other half of the machine was no better. The camera
system's own README described its setup as a stopgap and said plainly that it could not survive a reboot.
Two services, running on the same box in my closet, sharing exactly one flaw: they ran until something
interrupted them, and then they stayed down until a human intervened.

So the acceptance test for the whole project was a single sentence. **Come back unattended from cold.**
Everything below serves that.

## What was actually running, which took longer to establish than it should have

The closet machine ran Windows 10 Enterprise LTSC, with the real work happening inside WSL. It powered two
things: [SavePoint](https://savepoint.fm), an online radio management platform that streams to Discord and
YouTube, and a home surveillance system I wrote myself for a doorbell camera and a driveway camera.

Working out which machine ran which service was the hard part, and I got it wrong twice. I first concluded
that both workloads lived on the closet machine, then that both lived on my workstation. Neither was
right. The camera monitor was running on the workstation as a development stopgap, while the production
radio ran in the closet. Establishing that meant reading running processes, listening sockets and
mediamtx's own API, because two installations of the same software look identical from the outside.

If you take one thing from this article before the technical content starts, take that. **The hardest part
of migrating a home server is often working out what you actually have.**

## Why this is not a physical-to-virtual conversion

The obvious reading of "move the machine to Proxmox" is to image the Windows install into a virtual
machine and carry on. I did not do that, and the reason is worth stating.

Imaging Windows into a VM preserves the exact thing I was trying to escape. WSL2 is itself a virtual
machine, so running it inside another virtual machine means nested virtualization for no benefit
whatsoever. And neither workload actually needed Windows. The camera stack is Python and ffmpeg. The radio
platform is an Electron desktop application wrapped around a Fastify server, and the migration runs only
the server, headless, which is the reason it fits in a container at all.

So Windows and WSL both disappear, and the workloads run natively on Linux.

## What LXC is, and how it differs from a virtual machine

This is the part most worth understanding, because the difference is not a detail.

A virtual machine emulates a computer. It boots its own kernel, runs its own device drivers through
QEMU, and holds its own memory. When you give a VM 4 GB, that 4 GB is allocated to it and the host cannot
use it for anything else, whether the VM is busy or idle.

An LXC container shares the host's kernel. There is no guest kernel to boot, no QEMU, no virtio device
state. What you get instead is a set of isolated namespaces and cgroup limits around a normal Linux
process tree. In practice a bare Debian container idles at something like 30 to 60 MB of RAM before you
run anything, where the same services in a VM cost 200 to 400 MB just to exist. A container starts in
under a second. A VM takes 15 to 30 seconds to boot.

**Unprivileged** matters too. An unprivileged container maps its root user to an unprivileged user on the
host, so root inside the container is nobody in particular outside it. Both of mine are unprivileged.

Here is the part I originally described, incorrectly, as load balancing. Proxmox does not balance load
between containers. What actually happens is subtler and more useful: **the `cores` setting is a ceiling,
not a reservation.** I have allocated 10 cores across 8 threads, deliberately overlapping, because each
service can burst up to its ceiling whenever the other is idle. Container memory is elastic in the same
way, where VM memory is not without ballooning. On top of that, `cpuunits` gives the cameras priority over
the radio when both want the CPU at once.

That distinction is the real efficiency argument, and it is more interesting than "load balancing"
suggests.

## Proxmox, and yes, try saying it three times fast

[Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment/overview) is a Debian-based
virtualization platform that manages both VMs and LXC containers behind one web interface. I am running
9.2.2, which sits on Debian 13.

The machine is now, unavoidably, the ProxMoxBox box. Say it three times fast. I will wait.

There is a genuine reason to pick Proxmox beyond the feature list, and it is the ecosystem. Home servers
have a large and active community of people solving the same problems, publishing helper scripts, and
answering questions from someone running exactly your hardware. That is worth a great deal when something
does not work at two in the morning.

## The hardware, which shaped every decision

The host is an i7-7700 with 12 GB of RAM on an ASRock H110 Pro BTC+. That is a crypto mining motherboard,
which is exactly as odd as it sounds and is the reason several things below are the way they are.

Three constraints followed directly from the hardware.

**Wi-Fi cannot carry a bridged container.** An access point drops frames whose source MAC address is not
the associated station, so a bridged container never receives a LAN address. My containers therefore sit
behind NAT on their own subnet. I want to be precise about this because it is easy to present as a
security decision: it is not one. It is a workaround for a wireless limitation.

**12 GB of RAM rules out ZFS**, because the ARC cache would compete with the containers for the memory
they need. The host uses ext4 with LVM-thin instead.

**Bulk storage over USB under a service that writes continuously** is the weak point of the build, and it
caused real trouble.

## Two things that went wrong, and what they taught

The machine would not complete POST with the USB disk attached. I chased a kernel USB quirk first, then
suspected the hub. Both theories were wrong, and the giveaway was that the F11 boot menu would not open
either. That proves the stall happened before any bootloader ran, which means no kernel parameter could
ever have fixed it. The actual fix was in firmware: disable Legacy USB Support and enable XHCI Hand-off.

The second lesson arrived by accident, twice, and makes a better argument for journaling filesystems than
any explanation could. The same drive was pulled while mounted on two separate occasions. Formatted as
exFAT, it came back dirty, demanded a full repair, and recovered 8.5 GB of orphaned fragments into a
`FOUND.000` directory, with eight files having earlier failed to copy with silent I/O errors. Reformatted
as ext4 and abused identically, `e2fsck` replayed the journal and reported zero errors across all five
passes.

Same drive, same mistake, different filesystem, entirely different outcome. exFAT has no journal.

One honest loose end: that drive is rated for 550 MB/s and delivers about 40. I tested and eliminated the
filesystem, the hub, the cable and both machines, and I still cannot explain it. It is fast enough for
streaming, which needs roughly 1 MB/s, and only painful for bulk copies. I would rather say that than
invent a cause.

## Reaching it: Tailscale, and what actually provides the security

Neither service is exposed on the public internet. There is no port forwarded on my router, and there is
no reverse proxy with a certificate facing the world. Everything is reached over
[Tailscale](https://tailscale.com/), running 1.102.2 in both containers.

Tailscale builds a private mesh network between your own devices. Its MagicDNS feature gives each machine
a stable hostname on that network, so I reach the radio and the cameras by name rather than by chasing an
IP address that changes. Because every connection is initiated outbound from the device, it works
perfectly well from behind the NAT described earlier. NAT traversal is a convenience here, not a defence.

I want to be careful about that last point, because it is the sort of thing that gets stated loosely and
then repeated. **Not exposing a port is real and worthwhile, but obscurity is not the security boundary
here. The tailnet access control list is.** Only devices I have added to my network can reach these
services at all, and the ACL decides which of those devices may reach which service. That is a policy I
control and can audit, rather than a hope that nobody scans my address.

On cost: as of the pricing change in April 2026, Tailscale's free Personal plan covers up to 6 users with
unlimited devices, which is comfortably more than a household needs. Check the current terms before you
rely on that, since it changed once already this year.

There is one container-specific trap worth recording. **Tailscale in an unprivileged LXC container needs
`/dev/net/tun` passed through explicitly.** Containers do not get it by default, and without it the daemon
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

The concrete result, though, is already visible. **Both containers running put the host at 2.0 GB used
with 9.4 GB available.** The same two workloads as virtual machines would have consumed roughly 6 GB
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

**That project is not open source yet.** I intend to publish it this year, and I will update this article
with a link when it is available.

## What migration is actually good for

A migration is an excellent bug finder, because it forces every assumption into the open. This one
surfaced four latent faults in the camera project that had never been triggered: a recorder configured to
dial an RTSP port that nothing was listening on, systemd units bound to a service that had been replaced
and no longer existed, a restart-limit directive sitting in the wrong section where systemd ignores it
entirely, and a hardened unit with no write access to the directory it records footage into.

None of those were caused by the move. All of them were waiting.

---

If you self-host anything, the question worth asking is not whether your services are running. It is
whether they will come back on their own after the next power cut. Mine did not, and that is what started
this.

For more tutorials, AI skills and member-built products, have a look around
[GBTI Network](https://gbti.network/). We are a developer co-op, and this is the sort of thing we spend
our time on.
