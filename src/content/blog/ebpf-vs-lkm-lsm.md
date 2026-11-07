---
title: "Don't Write a Kernel Module (Unless You have to)"
date: 2026-10-07
description: "In this blog I dive into the various ways one might interact with the kernel at ring 0 level"
tags: ["tech", "linux"]
---

You want to run some code at the kernel mode ( ring 0 ), do you? 
> When I say "kernel mode" I mean code running with kernel privileges, in kernel context with access to kernel memory. 

The kernel space should be taken with great seriousness, access to it should be done very sparsely and avoided unless absolutely necessary and we should execute programs in the user-space as much as possible. One of the reasons is because the maximum damage a buggy user-space program could do from a execution perspective is a program tripping over itself and crashing ( i mean bugs and not someone intentionally destroying things like rm -rf /, a fork bomb and what not), A buggy user-space program does not cause a kernel panic or cripple the operating system. The kernel ensures this. When a program runs in user-space, the all-encompassing kernel with the help of the CPU's hardware protections ensures that the program is not doing anything naughty. Unfortunately we do not have this fail-safe for programs that run in the kernel space - if a program does something it should not, if a kernel space program runs into a bug and crashes, its over 🥀

Ok so clearly we need to be extra careful when running things in the kernel space, so why do we need to write programs that run at ring 0 ( kernel space )? Turns out user-space has its limitations and there are some things that can only be done at the kernel level, this is because the kernel sits between every program and the hardware, it sees everything: all memory, all devices, all packets and all scheduling decisions. A user-space program can only see what the kernel chooses to show it.

1. hardware - 
device registers, interrupts and DMA are all exclusive to the kernel. if you are making a driver for a hardware device ( nic, gpu, custom usb gadget) you have no option but to write that code in the kernel space.
> user-space drivers do exist, such as VFIO, UIO, and DPDK, but they still rely on a kernel piece to set them up
2. observability - 
the kernel sees every systemcall, every context-switch, every packet, every file in the device. This level of visual access gives kernel space observability programs incredible advantage, you can answer questions like "why did this request take 200ms?" or "does this program persist to disk after every write?" from the kernel which is efficient as opposed to using something like ptrace from the user-space.
3. performance - 
say you are building a program that needs to read a network packet and need to make a decision on wether to let it pass or drop it, if you are sending each packet to the user-space to decide this then your app is too slow, making this decision on the kernel when the packet arrives avoids that cost.
4. security - 
a user-space program could watch events and react but it cannot stop them reliably. An attacker with higher privilege can simply kill it and move on with their malicious plans. Since the kernel is the one point where everything has to pass through and you need "this process can never read that file" guarantees, the only option is to run these checks in the kernel and this is exactly what LSM hooks are for.

Ok, so how do you **safely** run code in the kernel space?

We have two primary ways? the newer eBPF and the traditional LKM.

## LKM
LKM stands for Linux Kernel Module and it has been the 
