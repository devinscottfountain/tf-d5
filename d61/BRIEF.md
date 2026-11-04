# Direction 6.1 brief (designer: Tim)

D6 with changes. Webflow page **Direction 6.1** `/direction-6-1` (id `6aeb9d772036553b903cda16`, duplicated from D6 page `6ae8edf1481a55869b89714c`). NOT linked from the index. D6 and D5 pages must keep working exactly as they are.

Figma: file `XCCTVzFivyIw11FDb1IH53`, section `22954:281` "Direction 6.1".
- Full design `22949:325` (1600 x 11049). Storyboard `22921:11488` (loader `22916:111`, hero `22912:161`, zoom `22918:10793`, series B + mission `22918:10821`, mission -> solutions `22920:10960`, control `22920:11162`, execution `22920:11334`).
- The Figma MCP can't hand files to the container (figma.com is blocked from the shell). Use `get_screenshot` with `enableBase64Response: true` and `maxDimension` <= 1100 to look at nodes; big nodes drop the connection, so screenshot children. Assets reach Webflow through the browser pane (see D6 workflow notes in `/home/claude/tf-d5/d6/BRIEF.md` and the page agent history).
- Never em dashes (copy or comments). Concise comments. Fonts: Geist 400/500 (stand-in for APK Galeria), IBM Plex Mono 500 uppercase 0.1em for labels.

## What stays from D6
Loader, 3D hero, zoom into Series B card, mission + topo, Solutions (dot grid, 3 modes, dig game, machines), right rail, nav.
**Change:** Solutions tab cards now sit ABOVE the 3D scene (label + H2 + 3 cards stacked at the top, scene fills below; see `22920:10960`, `22920:11162`, `22920:11334`). Keep the rail (Tim's comment asked about the client's old menu; Devin decided the rail stays).

## New sections, in page order after Solutions
1. **Benefits** (`22949:501` + `22949:520`): label BENEFITS, H2 "Helping real people in meaningful ways" left; right column rows Faster / Cheaper / Safer, each: word, tick, rule, tick, copy; hairline separators. Reveal on scroll.
2. **Our tech in action** (`22949:521`): label, H2 "Our tech is deployed across multiple job sites, delivering value to customers while improving our systems and collecting real-world robotics data", corner bracket, prev/next square buttons. Card track: active card bright (title, lorem body, CUSTOMER Starbucks / LOCATION Austin, TX / SCOPE 27 acres / TIMELINE 3 months, top rule with ticks), inactive cards dimmed with title only. 3 placeholder cards as designed. **Each card is a muted looping background video** (poster = the Figma still; `<video>` slot with `data-src`, no footage yet). Only the active card's video plays. Arrows + swipe/drag only, no auto-advance. Links `#`.
3. **Mars, 3 beats (3D, reuse D5 Mars mode)**
   - Beat 1: "One day / on Mars" split around the planet (keep CLEAR AIR between the words and the disc, never bite letters), "SOL 0206" scale under it (`22951:8883`): a **scroll counter**, tick moves and the sol number counts up across the Mars run.
   - **Planet look changes:** lit from the front-left so you see the full orange disc with surface detail (Tim's ref: like the Figma Mars image `22950:684`), and KEEP the glowing atmospheric rim we have. Still a live 3D planet.
   - Beat 2 (`22950:695` area): "At SpaceX we built the rockets to reach Mars." top-left, "Now we're focused on the payload, the tech that will make multiplanetary life possible." bottom-right around the lit planet. Tim: "added some more text, fade it in wherever you think is best".
   - Beat 3 (`22950:706`): dome colony (D5 Jezero build) with "Every breakthrough we make on Earth brings us one step closer to that future." top-left.
4. **Closing CTA** (`22950:747`): label JOIN OUR TEAM, H2 "Come build a brighter future.", white "View open roles" button + plus box, corner ticks. Links `#`.
5. **Footer, 3D scene** (`22951:8878`, `22952:8961`): Mars dusk horizon: low ridge line, a big glass dome with greenery inside, smaller domes, a row of habitat modules / pressurised cylinders, two Starships standing on the right, a rover, dark foreground regolith with rocks. Dark sky with warm sunset glow behind the ridge. Over it: huge TerraFirma logotype (mark + wordmark, #D6D9E3), Careers / Contact links, "TEXAS BORN. MARS BOUND." centre with rules, LinkedIn + X icons, copyright + TERMS OF SERVICE / PRIVACY POLICY. Links `#`.
   - **Glow (Tim):** "the light would be cool to glow from behind once you scroll to this view". Devin chose BOTH: scroll drives a sunrise (glow rises and brightens behind the ridge as the footer scrolls in, peaks at rest), then a gentle ambient shimmer at rest.

## Quality bar
Same as D6: Mars / Earth fidelity, fast first frame, textures stream in, render only when on screen, 60 fps on a laptop, graceful low tier and mobile (390x844). Accept no compromises on look.
