# Internal questions

Open questions about the project that haven't been decided yet. Once one is decided, move it to
the relevant doc (e.g. a decision in [release-plan.md](./release-plan.md)) and remove it here.

Public questions and answers live in the "Questions" section of the site (`apps/site/public/index.html`).

---

## "Last seen by someone" for libraries that may be gone

A tester often finds libraries that no longer exist (Street Library removes them once the keeper
can't be reached) and asked to see when another user last visited one: a recent visit means it's
worth looking harder. (2026-11-10)

- Visits are on-device only today, and the privacy policy says so. This would need the app to send
  something per visit to our server: at most an anonymous "seen on <date>" per library, never a
  history or anything that links visits together.
- A "Couldn't find it" button could go with it, as a count shown to others and maybe a report to
  Street Library (see the held `feature/add-missing-library` branch for the email approach).
- Opt-in or on by default? Data safety and the privacy policy change either way.
- Play Data safety (checked 2026-11-10 against Google's Data safety help, answer 10787469):
  sending reports is "collection" (data transmitted off the device). Anonymity doesn't exempt
  collection (only sharing), and storing a last-seen date per library isn't "ephemeral". It
  would be **Location > Precise location** (an exact public place on a date; under 3 km²),
  **collected, not shared** (our own server; Cloudflare is a service provider), purpose **App
  functionality**, and **optional** only if everyone can turn it off. Precise location is
  already declared (walks from your position), so the form gains a use, not a data type, but
  its "only when planning a walk" wording in `docs/release-plan.md` changes.
- Play's location policy wants a prominent in-app disclosure when collection isn't within the
  user's reasonable expectation: show a one-off card at the first visit saying what's sent, with
  the switch to turn it off.

## Donations

Should there be a "buy me a coffee" style donation link, for people who appreciate the app on
Android or want to see it released on iOS?

- The App Store fee (US$99/year) is the main thing blocking iOS; donations could be framed as
  covering it.
- Would need a place on the site (and maybe the app's ⋯ menu). Check Google Play's payments
  policy before linking to donations from inside the app.

## Video demos on the site

Should the site include short videos of the app in use (finding a library, logging a visit, the
nearby card walking someone in)?

- Weigh page weight against the current static screenshots (respect `prefers-reduced-motion`,
  don't autoplay with sound).

## Screenshot locations

All the site screenshots show Adelaide, and people have asked whether the app is Adelaide-only
(it covers all of Australia). Should some screenshots show other cities (e.g. Melbourne, Sydney,
Brisbane)?
