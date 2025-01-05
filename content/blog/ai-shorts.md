+++
title = "App 1: AI Shorts"
date = 2025-01-05
description = "This blog talks about my 1/12th app"
[taxonomies]
categories = ["Growth"]
tags = ["engineering", "growth"]
[extra]
lang = "en"
toc = true
# featured = true
+++

We had decided for a while that we were going to make an AI short form video generator application. The idea came to us when we were all drinking chiya at Kamal Pohkari. We all saw the plethora of weird AI generated stories in our instagram reels and thought "hey why don't we build something that will help people create such content and we can sell it as a service".

I liked the idea and was willing to work on it. Krish started to work on a proof of concept right away and a few months later here we are building it for real. Aashish Dai is making the frontend right now, the backend is halfway done and we're scheduled to release on 1st of Feb 2025. 


I initially wanted to build the entire backend in go, supabase and use rabbit-mq as the event queue however there was no official supabase sdk for golang and I didn't really like the rabbitmq packages for go either so we decided to do the backend in Hono and use redis as the event queue. Supabase is incredible, once I got used to its idiosyncrasies ( RLS, Anon and Service Keys) the productivity level increased massively. 

We used the Pub/Sub pattern and the backend published the data to the queue and returned the response to the user and the task was handled in the background by the redis consumers. In total we had 5 states.
```
1. pre_queue -> backend publishes the data to the queue.
2. prompt -> generates the caption and image prompt and publishes data to 11labs.
3. audio -> gets audio, uploads in supabase storage and publishes to huggingface.
4. image -> gets images, uploads them to supabase storage and publishes to assemblyAI.
5. caption -> generates caption, uploads them to supabase storage and publishes to remotion.
6. remotion -> assembles everything and uploads the final mp4 to supabase storage.
```

I wanted to dispatch `audio`, `image`, `caption` parallelly however the failure of even one consumer would mean that the video would not get created, our API credits would be wasted and that was not acceptable for us. So we decided to do it sequentially even though it was going to be a bit slower.


We had 4 services or external API's that worked together along with Remotion to create the final video. We were using Gemini for the prompt generation, It required us to add an external dependency, I would have preferred to use just fetch but hey what the hell. We obtained `imageData` and `imageCaption` for `n` objects based on the length of the video the user wanted.

We passed the `imageCaption` part of the object returned from the Gemini APi to elevenlabs for audio generation, The voice ( m or f ) was also passed along with the text here. HuggingFace was next and Assembly AI was last.

{{ figure(src="/img/states.png" alt="States of Video Creation" via="https://x.com/aashu10sh" ) }}

This meant our application could process ~ 10 videos parallelly on a decent server. We have a credit system in place to allow people to create videos effectively. The unit of creation on our platform is **volts** and relation between volts and videos is

```
1 volt = 2 second
```

We give you 60 volts on sign up so you can test and run our application and we have different tiers where you can buy extra volts by using Stripe.

The application is not ready yet and we will certainly change a few things before deploying on Feb 1st, We hope you'll try it out.




