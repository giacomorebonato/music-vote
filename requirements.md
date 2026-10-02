# Requirements

## Description

music-vote is a website where anyone can create a music performance that anyone enjoys while contributing to it with their phones.

## How does it work?

User A decides to create a music room and completes login into the platform.
A few parameter are decided like:

* how long the song is going to be?
* BPM?

A QR code is provided so the people listening to the music can provide feedback while the dance to the music.
There is going to be a poll every 2 minutes (let's make this interval variable) where users are going to be asked with AI generated questions like:

> sharper drums or warmer chords?
> a wider stereo pad or a dirtier bass?
> open the filter or freeze the groove?

Every option is a different change to the music — a poll never offers a "keep it as it is" or yes/no answer, so whichever option wins the song changes. The end poll (wrap up vs keep going) is the one lifecycle exception.

And this is what makes this concept cool: democratically the song changes depending on what people listening to it want.

## Tech stack/points

* re-use my mino-starter kit
* deployment to Fly.io
* use Tigris as S3 storage if needed
* use https://codeberg.org/uzu/strudel for live coding music
* I think that poll results could even be stored on a file, given that I expect to have hundreds of listeners, unless this project explodes
* use AI to generate good questions, the provider can be my Ollama subscription
* use AI to generate code that plays music
* use AI to categorise appropriately music and answers
* Ollama now provides this https://ollama.com/blog/ollama-now-supports-jev-style-decision-models evaluate if it can be useful in this context
