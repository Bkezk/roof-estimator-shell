# The workflow's bottom bar on a phone

Nov 18, 2026. The owner sent two pictures from his iPhone.

1. "The two buttons at the bottom are kinda cut off can you adjust them up a smidge or reshape
   them so they fit better and color them blue, the same blue as in the logo".
2. "I had this bug the other day after drawing on the takeoff where step 2 stayed in the middle
   of my screen". The picture shows the pinned bar a quarter of the way up the screen, with the
   page showing under it.

## 1. The two buttons

**Cut off.** The bar kept 0.75 rem under the buttons, or the phone's own safe area when that is
larger. The phone reports no safe area to a page that does not ask for the whole screen, so the
gap was about 10 px and the buttons sat under the phone's home bar. On a touch screen the bar now
keeps 2 rem, about 26 px. A mouse keeps the smaller gap. The class is `PINNED_BAR` in
`src/components/service/closeout.tsx`, used by both of the workflow's bars.

**Blue.** The logo's letters were measured from `public/jbk-logo.webp`: 146,000 pixels of one
blue, `#014b96`. It is `--jbk-blue` in `src/styles.css`. White words on it read at 8.6 to 1. The
two buttons of the workflow's bar are filled with it, with slightly rounder corners, and are 36
px tall. The same pair on a ticket's header and on a property keeps its outline: they sit beside
New ticket and Edit there, and the owner asked about the bottom ones.

## 2. The bar in the middle of the screen

The bar is pinned to the bottom of the screen by the browser. Nothing in the site moves it. The
aerial picture already refuses the browser's own scroll and zoom gestures.

The picture matches a fault of iPhones on iOS 26 that others report: after the keyboard closes,
the part of the page the screen shows is left out of step with the page, and everything pinned is
drawn in the wrong place until the page next moves. Typing a tag or a note on the aerial, or in
"Search all repairs", brings the keyboard up.

**The guard.** `watchIosPinned` in `src/lib/ios-viewport.ts`, started once for the whole site. On
an iPhone or iPad only, a quarter of a second and again 0.7 of a second after a text box is left
or the visible part of the page changes size, the page is moved a pixel and back and each pinned
bar is placed again. The page ends exactly where it was. Nothing happens while a box has the
keyboard. The office pages' save bar is covered too.

**What is and is not proven.** The fault cannot be made to happen off an iPhone, so the guard is
not proven against the fault itself. Proven here: it runs only for an iPhone, it waits for the
keyboard to be away, it moves the page a pixel and back, and it leaves the scroll and the bar
where they were. If the bar is seen floating again, scrolling the page a little puts it back, and
what was tapped just before is worth knowing.

## Proof

Tests: `src/lib/workflow-bar-nov18.test.ts` (17).

Browser set up as an iPhone 15, technician-only login, every write blocked, two temporary
tickets.

| Check                                       | Result                                           |
| ------------------------------------------- | ------------------------------------------------ |
| Colour of both buttons                      | `rgb(1, 75, 150)`, white words                   |
| Height of each button                       | 36 px                                            |
| Space under the buttons, bar at the bottom  | 26 px. It was about 10 px in the owner's picture |
| The first screen of a repair, before step 1 | The same two blue buttons                        |
| Guard, while a text box is focused          | The page is not moved                            |
| Guard, after the box is left                | Moved 400 to 401 and back, twice. Ends at 400    |
| Bar after the guard                         | At the bottom of the screen                      |

The temporary tickets were removed after. No notices were written.
