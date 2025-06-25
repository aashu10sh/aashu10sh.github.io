+++
title = "How Deerwalk College's Doko was Hacked"
date = 2024-12-20
description = "Deerwalk College's Student Profile and Exam papers management system Doko was hacked by Indo hackers"
[taxonomies]
categories = ["tech"]
tags = ["leadership","hackathon"]
[extra]
lang = "en"
toc = true
+++

A few week ago, Deerwalk college's student profile and exam paper management system [Doko](https://doko.dwit.edu.np) was hacked by Indonesian hackers and defaced to show a online casino slot platform. The DevOps team went into damage control mode and changes were made. The first thing we did was change the Policy of the security group of our Amazon EC2 instance to only allow connections from within the college network. We werent quite sure of how the hacker got in or how they managed to deface our application which was built with Laravel.

A few days later I was sent the `access` and `error` logs by the DevOps team to properly analyze the network traffic to figure out how they got in. I saw a Indobesian IP address logging in to our system. How did they get our credentials? Turns out we were using the username `admin` and the password of `password` when we were developing the application and never really got around to changing it. Now the hacker had access to the management/admin panel, great.

How did they get remote code execution on our system? As I was going through our uploads directory and was searching for a potential file upload vulnerability and there it was. A rogue `.php` file (`"Srijal Jaisi.php"`) with a real students name.

