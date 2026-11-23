# Handoffs

Work one agent or machine left for another to pick up. Each item sits under the
platform that can do it. `AGENTS.md` has the routing rules.

Every item has:

- **What:** the change or check, with the commits or files involved.
- **Verify:** how to tell it works, step by step.
- **Added:** the date and the session or platform that left it.

When an item is done, delete it here and say what you found in the commit
message. If you find a bug, fix it in the same change or leave a new item.

## Windows only

1. **Frost's Acrylic while dragging the window.**
   - **What:** Frost sets `--window-material: frosted` in
     `ui/src/themes/frost/theme.css`, and `set_material` in
     `src-tauri/src/environment.rs` swaps Mica for a lightly tinted Acrylic
     (`24, 26, 32, 96`). The `window-vibrancy` 0.8 docs warn that
     `apply_acrylic` lags while resizing or dragging on Windows 10 1903 and
     later and on Windows 11 build 22000. They warn that `apply_blur` lags on
     build 22621 and later. Newer builds are untested.
   - **Verify:**
     1. Note the Windows build from `winver`. Pick Frost in Settings: the
        desktop shows blurred through the window.
     2. Drag the window by the toolbar in circles for a few seconds, on a 60 Hz
        display and, if there is one, a high refresh display. The window keeps
        up with the pointer, with no stutter or blank frames.
     3. Do the same with Graphite, which uses Mica, to compare.
     4. Resize from a corner with Frost on: the blur follows without flashing.
     5. If Frost lags, record the build here. Keeping Mica for Frost on that
        build would trade the see-through desktop for a window that keeps up.
   - **Added:** 2026-11-03, macOS session.

2. **Swatch under other accents and light mode.**
   - **What:** a Windows session on 2026-11-03 checked two things with the
     purple accent `#881798` in dark mode. Swatch's tiles and its Settings
     preview take the accent, and turn blue with "Tint the theme with the system
     accent color" off. Pride on a dense Crosses board draws counts from 9 as
     rings with open middles, lists 1 to 14 under the board, and shows the digit
     and lights its chip on hover. Changing the system accent and the light or
     dark mode is left to the maintainer.
   - **Verify:**
     1. Pick Swatch. In Windows Settings, Personalization, Colors, pick Storm
        (dark gray), then Gold, then the default blue, switching back to
        Polymine after each: the tiles follow, and the flag, digits, and focus
        ring read.
     2. Repeat with Windows in light mode.
   - **Added:** 2026-11-03, macOS session; narrowed by the Windows session.

3. **Updating from one release to the next.**
   - **What:** the updater (`src-tauri/src/updates.rs`, `UpdateNotice.svelte`)
     with the NSIS installer in passive mode. Signing was checked locally with
     throwaway keys; no installed copy has updated yet.
   - **Verify:** install the first public release with its setup `.exe`, then
     publish the next one. On launch, the notice offers it; Install and restart
     shows the download, the installer's progress window, and then the new
     version, with the game, the window's place, and `polymine-cli` on `PATH`
     kept.
   - **Added:** 2026-11-22, Windows session.

4. **Board CPU and GPU before and after the idle fixes.**
   - **What:** two pull requests cut the board's work in
     `ui/src/lib/board/BoardView.ts`.
     `fix(ui): stop pixi's system ticker so an idle board draws no frames` stops
     Pixi's system ticker, which asked for a frame 60 times a second while
     nothing moved.
     `fix(ui): hit-test the board only for pointer moves that need it` turns off
     Pixi's global move events, which walked every cell on each pointer move. On
     a 2019 Intel MacBook Pro, idle CPU fell from 7.6% to 1.2%, paused from 7.7%
     to 0.1%, WindowServer's extra load from 19 points to 0.7, and hover on a
     30×20 board from 23.3% to 14.2%.
   - **Verify:**
     1. Compare v0.1.1, installed today, with a build from `main` once both pull
        requests merge. Run the `main` build as a named instance.
     2. Measure CPU and GPU for `polymine.exe`, the `msedgewebview2.exe`
        processes (browser, renderer, and GPU), and `dwm.exe`. Take a baseline
        with Polymine closed, then sample each scenario for 15 to 30 seconds
        rather than reading Task Manager:

        ```powershell
        Get-Counter '\Process(*)\% Processor Time','\GPU Engine(*)\Utilization Percentage' -SampleInterval 1 -MaxSamples 20
        ```

     3. Scenarios: idle while playing, paused, the window in the background, the
        pointer moving over the board, play through `polymine-cli`, a window
        resize, and a 120×80 board.
     4. Run them with Frost (Acrylic) and Graphite (Mica), with Transparency
        effects (Personalization, Colors) on and off, and with Animation effects
        (Accessibility, Visual effects) on and off. Note the display scaling and
        refresh rate.
     5. After the hit-test fix: a left-button press dragged across cells moves
        the press, a middle-button drag pans and keeps panning when the pointer
        leaves the window mid-drag, a release outside the window ends the press
        or the drag, and hover highlights cells. On a touch screen, a hold flags
        and a pinch zooms.
     6. After the ticker fix: the board still animates when it should, such as
        on a win or a hint, and idle CPU is near zero.
     7. Reply with the numbers in a table, one row per scenario and process, so
        they line up with the Mac profile.
   - **Added:** 2026-11-23, macOS session.

## macOS only

1. **Window and vibrancy fixes, by hand.**
   - **What:** `324103a` (window starts hidden), `de459ab` (placement saved on
     Cmd+Q), `6e6de7b` (bounds in points), `1f81c17` (vibrancy cleared before
     reapplying). Each needs a real window, so no test covers it.
   - **Verify:**
     1. Launch: the window appears once, already at its saved place, without a
        jump from the center.
     2. Move and resize it, quit with Cmd+Q, relaunch: same place and size.
     3. With a Retina screen and a 1x external display, quit on one and relaunch
        on the other: the window keeps its size in points.
     4. Switch between Frost and another theme a few times: Frost shows the
        frosted backdrop every time.
   - **Added:** 2026-11-03, macOS session.

2. **VoiceOver pass.**
   - **What:** `9ce4d9c` (hint announcements name the cell), `706f2ab` (toolbar
     figure names, board role).
   - **Verify:** with VoiceOver on, ask for a hint: it reads "Row r, column c"
     before the hint. Move to the toolbar: flags left and time are read with
     their names.
   - **Added:** 2026-11-03, macOS session.

3. **Settings' General section at the minimum size.**
   - **What:** the player picker added a row and two buttons to General in
     `ui/src/components/SettingsDialog.svelte`. The design says General and Bot
     fit without scrolling at 800 by 600 on macOS, which only a Mac shows.
   - **Verify:**
     1. Run a named instance, shrink the window to 800 by 600, and open
        Settings: General shows every row without scrolling.
     2. Add a player with a long name: the picker, Add, and Remove stay on one
        row beside their label.
   - **Added:** 2026-11-04, Windows session.

4. **The ferrofluid effect on WKWebView.**
   - **What:** `ui/src/lib/board/ferrofluid.ts` renders into half-float targets,
     which WebGL2 allows only with `EXT_color_buffer_float`, and marches rays
     through the spikes in the fragment shader. It was built and tuned on
     WebView2 with a high-end desktop GPU.
   - **Verify:** run `npm run app` as a named instance and pick Ferrofluid, the
     last theme in the Signature section of Themes.
     1. Closed cells are glossy black domes with white highlights, not flat
        black or white: the half-float targets work.
     2. Move the pointer over the board: spikes rise around it and lean up the
        screen. Right-click a cell: a tall spike with a red tip rises.
     3. Lose a game: every pool of fluid throws up spikes, which slump back.
     4. Note the frame time with the magnet up, from Safari's Web Inspector
        timeline, in `docs/todo.md` under the experiment.
   - **Added:** 2026-11-04, Windows session.

5. **The rest of a release on a real Mac.**
   - **What:** these need a real Mac, and no test covers them: the accent tint,
     vibrancy, the HUD blur under Frost, the traffic light offset, the toolbar
     as title bar, the H, B, and P menu shortcuts, WASD on the board, the Edit
     menu's clipboard shortcuts, and Reduce Motion.
   - **Verify:** run a release build as a named instance and check each one.
     Change the system accent and the light or dark mode while it runs, and turn
     on Reduce Motion in System Settings, Accessibility, Display.
   - **Added:** 2026-11-05, moved from `docs/todo.md` by a macOS session.

6. **Two fixes only a Mac can make.**
   - **What:** a review on Windows found two macOS bugs it couldn't compile or
     run. `link` in `crates/polymine-cli/src/main.rs` deletes any regular file
     called `polymine-cli` in the target folder before linking; it should
     replace only a symlink and refuse a file. And a rule toggled from the
     native menu while Settings is open is reverted when Settings closes,
     because the dialog saves its whole draft (`SettingsDialog.svelte`).
   - **Verify:**
     1. Put a regular file called `polymine-cli` in `~/.local/bin` and run
        `polymine-cli link`: it refuses and leaves the file.
     2. Open Settings, toggle Smart click from the menu bar, close Settings: the
        toggle sticks.
   - **Added:** 2026-11-07, Windows session after the adversarial review.

7. **Updating from one release to the next.**
   - **What:** the updater (`src-tauri/src/updates.rs`, `UpdateNotice.svelte`)
     and the release workflow's `app,dmg` bundles and Sign updates job. Windows
     checked the signing with throwaway keys; no Mac has built the app archive
     or installed an update.
   - **Verify:**
     1. In the first release's run, the macOS builds upload
        `Polymine_X.Y.Z_aarch64.app.tar.gz` and `_x64.app.tar.gz`, and
        `latest.json` lists both.
     2. Install that release from its DMG, then publish the next one. On launch,
        the notice offers it; Install and restart replaces the app in
        Applications and reopens it at the new version, with the game and the
        window's place kept.
     3. Settings, General: switching off Check for updates automatically stops
        the startup check, and Check for updates still works.
   - **Added:** 2026-11-22, Windows session.

## Linux only

None yet.

## Up for grabs

None yet.
