# UX design

Status: **accepted and implemented** (2026-10-07). Mockups: [`docs/ux/mockup.html`](ux/mockup.html) (preview with `python -m http.server 8766` from the repo root, then open `/docs/ux/mockup.html`).

## Who uses Novel Route

| Who | What they want | How often / where |
|---|---|---|
| **Regulars** (primary) | Swap books often. Do a "round" of the boxes near home or work and want to know which ones are worth checking — the ones they haven't seen in a while. | Weekly. On foot or bike, phone in one hand, often in sunlight. Sometimes planning from the couch. |
| **Explorers** | Find the nearest box right now, or see what's in a suburb they're visiting. | Occasional. Unfamiliar streets, need "which way, how far". |
| **Stewards** | People who look after a library: check it's listed and looks right. | Rare. Point them to Street Library Australia to register or edit. |

What this means for the design:
- **Map-first, one-thumb.** Everything important is reachable at the bottom of the screen.
- **Calm.** The app is a walking companion. It should never block the screen to get attention.
- **Glanceable.** From the map alone you should see which boxes are worth a visit.
- **A little delight.** Logging a visit is the core moment; it should feel good.

## Key flows

| Flow | Steps today | Target |
|---|---|---|
| **A. "Is there one near me?"** | Open app → scan the map → tap markers to compare | Open app → a card at the bottom already says *"Flinders St Library · 260 m ↗"* → tap for directions |
| **B. Doing my round** | Remember which ones you visited; tap each marker to check | Faded/closed boxes on the map are "due". Tap one → compact card → Directions. Repeat. |
| **C. Standing at a library** | Wait for a modal alert, or find the marker and open the sheet | The bottom card turns into *"You're at Flinders St Library — Log visit"*. One tap. |
| **D. Exploring another suburb** | Pan; libraries load for that area | Same, plus a compact preview card so you can tap through markers without losing the map |
| **E. Fixing a mistake** | Open sheet → find visit → delete | Undo straight after logging; edit history from the detail view |

## Layout

One screen. A full-bleed map with three layers of UI on top:

```
┌─────────────────────────────┐
│ (sync pill)          [◎][?] │  top: tiny status pill; map buttons (my location, map key)
│                             │
│          map                │
│                             │
│ ┌─────────────────────────┐ │
│ │ bottom card slot        │ │  one card at a time (priority order):
│ └─────────────────────────┘ │   1. selected library preview
└─────────────────────────────┘   2. "you're here" arrival card
                                   3. nearest-due library card
                                   4. one-off hint card
```

Tapping the preview card (or "Details") opens the **library detail** as a floating panel over the map.

### 1. Nearby: replace the alert with a bottom card

The modal alert goes. Instead, a small card at the bottom of the map does two jobs:

- **Approaching** — shows the nearest library that's *due* (never visited, or last visited more than 30 days ago) within 2 km:
  `[doors icon]  Flinders St Library   260 m  ↗`
  - The arrow points to the library **relative to where you're facing**, using the compass heading (`Location.watchHeadingAsync`), like Google Maps' heading beam. The location puck also shows the heading beam (`LocationPuck` `puckBearing="heading"`).
    - Battery cost is small next to the screen and GPS that are already on. Subscribe only while the app is in the foreground and the card is visible.
    - Compass accuracy is the real risk: uncalibrated phones and nearby metal (cars, fences, the library's own post) can throw it off by 30°+. When the reported heading accuracy is low or missing, fall back to a **map-relative** arrow (north-up) and widen the puck's beam; when walking steadily, prefer GPS course over the compass. Smooth readings to avoid jitter.
    - Within the last ~30 m the arrow is least reliable, which is where the card switches to the arrival state anyway.
  - Tap the card → camera frames you and the library together; tap again → detail.
  - If nothing is due nearby, show the nearest library instead, with its status ("Visited 3 days ago").
- **Arrived** — within **30 m**, plus up to 20 m allowance for reported GPS accuracy (`ARRIVAL_RADIUS_M`, `MAX_ACCURACY_ALLOWANCE_M` in `src/store/nearby.ts`), the card changes to:
  `You're at Flinders St Library   [Log visit]`
  with a light haptic tick. Tapping **Log visit** logs it, plays the doors-opening animation on the marker, and shows *"Visit logged · Undo"* for a few seconds.
  - Ignoring it costs nothing; walk away and the card goes back to "approaching".
  - The card just reflects where you are. The haptic tick fires once per library per day (`nearby_prompts` table).
- **Nothing due nearby** — a dismissible suggestion card: the nearest due library further away ("Nothing due nearby · X · 4.3 km"), or "All caught up" if every cached library is fresh. Dismissing hides it for the rest of the session.

Why not exactly the "direction bubble + I found it" idea: the direction bubble is right for *approaching*, but asking people to confirm "I found it" is an extra concept. Arrival is detected automatically, and the action people actually want at that moment is "log a visit", so the card offers exactly that.

### 2. Library details: preview card + floating detail panel

Two levels, so quick decisions stay on the map and details get a proper page:

- **Preview card** (tap a marker): sits in the bottom card slot, about 140 pt tall. Marker icon, title, distance, status ("Last visited 3 months ago"), and two buttons: **Log visit**, **Directions**. Tap anywhere else on the card → detail. Tapping another marker swaps the card, so you can compare libraries on your round without opening and closing anything.
- **Detail panel**: opens as a floating card covering the screen with a **16 pt margin** showing the map around it (max width 560 pt, so tablets get a centred panel). Rounded corners and a shadow make it clearly "on top of" the map. Close with ✕, back gesture, swipe down, or tapping the map margin.

Detail panel content, top to bottom:
1. **Header**: large marker illustration in its current state, title, "260 m away".
2. **Status line**: "Last visited 3 days ago · 5 visits" / "Not visited yet".
3. **Primary action**: **Log visit** (full width). After logging today it becomes "Visited today ✓" with a small "Log another" link.
4. **Secondary actions** in a row: **Directions**, **Street Library page** (the listing's permalink — currently unused), **Share**.
5. **Description**, clamped to 4 lines with "More".
6. **Your visits**: a simple timeline (relative dates, "logged when nearby" tag). Each row has a ⋯ menu → Delete. **Clear history** moves into the header's ⋯ menu instead of being red text in the body.

### 3. Map and markers

**Base map: minimal.** Switch from Mapbox Outdoors to **Mapbox Standard** with a faded theme, point-of-interest and transit labels off, and flat (no 3D buildings). Streets, parks and suburb names stay; restaurants, hotels and hospitals go. Fallback if Standard doesn't suit: Mapbox Light.

**Markers: a little library on a post**, echoing the app icon. State is shown by **both colour and door position**, so it still reads for colour-blind users:

| State | Doors | Colour |
|---|---|---|
| Not visited yet | Closed | Warm amber — an invitation, not an error |
| Visited < 30 days | Wide open, books visible | Rich green |
| Visited 30 days – 6 months | Half open | Mid green |
| Visited > 6 months | Just ajar | Faded sage |

The metaphor: **a visit opens the doors, and they slowly swing shut over the months** — a gentle "time to go back". The post's foot is the exact location (icon anchored at the bottom).

- Selected marker: scaled up ~1.3× with a soft shadow.
- Size grows slightly with zoom so street-level views aren't cluttered by tiny icons or swamped by huge ones.
- **Clusters**: white badge with a coloured ring and the count — amber ring if any library inside is unvisited, green if all visited. Calmer than solid red circles.
- Implementation: PNG icons (@2x/@3x, generated from SVG source in `assets/markers/`) registered with Mapbox `Images`, drawn by a `SymbolLayer` that picks the icon with a `match` on `freshness`.

### 4. Hints without a tutorial

No wizard. Instead, small, one-off nudges that appear at the moment they're useful and never again once acted on (state stored in the `kv` table):

| When | Hint |
|---|---|
| First launch, before the OS location prompt | A short card: *"Novel Route uses your location to show nearby libraries and to let you log a visit when you arrive."* **Allow** / **Not now**. (Explains the permission instead of a bare system dialog; without location the app still works for browsing.) |
| Libraries first appear on the map | Bottom hint card: *"Tap a library to see details and log a visit."* Dismissed by tapping any marker. |
| After the first visit is logged | *"Doors open when you visit, and slowly close over the months — a reminder to go back."* (with the four door states inline) |
| Any time | **Map key** button (?) top-right: the marker legend plus one line on what the app does. |
| Empty area (zoomed into a place with no libraries) | Pill: *"No street libraries here yet. Know one? Register it with Street Library Australia."* |
| Location denied | Pill: *"Location is off — you can still browse. Turn it on to see what's near you."* with a settings link. |

### 5. Smaller fixes

- Sync status: replace the black "Updating libraries…" badge with a small pill under the status bar; errors become a pill with "Retry".
- "Re-center" text button → a round **my-location** button, always visible, filled when following.
- Touch targets ≥ 48 dp; all buttons labelled for TalkBack.
- Logging a visit: haptic feedback + the doors animation in the detail panel header.
- Visual language matches the website: warm paper background for cards, brand green, rounded 20 pt corners, soft shadows. Icons from `@expo/vector-icons` (already bundled with Expo).

## Later (not in this pass)

- **List view** ("Libraries near you", sorted by distance with status). Good for planning a round, and the accessible alternative to map markers for screen-reader users.
- **Your visits** screen and simple stats ("You've visited 14 of 52 libraries within 5 km").
- Route planning (docs/maps.md).
- Dark mode (Mapbox Standard's night light preset).

## Decisions (2026-10-07)

1. Amber for "not visited": yes.
2. Doors closing over time: yes.
3. Arrival radius: 30 m (plus GPS accuracy allowance, capped at 20 m).
4. Nothing due nearby: dismissible suggestion card.

## Implementation notes

- Marker artwork: `scripts/build-markers.mjs` (`npm run build:markers`) writes SVG sources and @1x/@2x/@3x PNGs to `assets/markers/`.
- Map: Mapbox Standard style, `theme: faded`, POI/transit labels and 3D off; rotation and pitch disabled (north-up), which also makes the fallback "map-relative" arrow correct.
- Bottom slot priority (`MapScreen`): selected-library preview → location explainer → arrived → "tap a library" hint → "doors" hint → approaching/suggestion. The undo toast stacks above whichever card is showing.
- Hints are stored in the `kv` table as `hint:<key>` (`src/store/hints.ts`).
- Not done in this pass: swipe-down to close the detail panel (✕, back gesture and tapping the map margin work).

### Review fixes (2026-10-07)

- Follow mode uses a **fixed** bottom padding, so the map no longer jumps when the bottom card changes; the measured card height is only used when framing points.
- Logging from the detail panel shows its own undo bar; "Log another visit" is hidden for a minute after a visit (the duplicate guard would ignore it).
- **Log a past visit** (detail panel): date picker, no future dates; past days are logged at midday. The duplicate guard checks for any visit within a minute of the chosen time.
- Logging from more than **200 m** away asks for confirmation.
- Without location the map starts on all of Australia; zoomed out over Australia/NZ with nothing cached in view shows **"Zoom in to find libraries"**. The API is never called outside Australia/NZ.
- The "tap a library" hint gives way to the nearby card after 10 s; the "doors" hint waits until the undo toast has gone.
- The compass is only read while the nearby card's arrow is showing (so the puck's heading beam only appears then too).
- The detail panel and map key size to their content, up to the screen minus the margin.
- The map's library layer refreshes freshness hourly rather than every minute.

### Loading as you pan (2026-10-07)

- Panning loads libraries from zoom 10: the 20 cells nearest the view's centre are requested once the camera has been still for 0.7 s. This is driven by `onCameraChanged`, because `onMapIdle` never fires after user gestures on Android (`@rnmapbox/maps` 10.3).
- **Loaded vs not loaded:** cells in view whose libraries aren't on the device yet get a light grey veil, so an empty clear area means "no libraries here" and a veiled one means "not loaded yet". Pills: *Updating libraries…*, *Zoom in to load libraries here* (zoomed out over unloaded cells), *Part of this area hasn't loaded · Retry* (close enough but still unloaded), *No street libraries here yet* (everything in view loaded and empty).
