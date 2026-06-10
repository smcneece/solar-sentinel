# Changelog

⭐ If Solar Sentinel is useful to you, consider starring the repo on GitHub so other HA users can find it. It takes two seconds and makes a real difference.
[Star Solar Sentinel on GitHub](https://github.com/smcneece/solar-sentinel)

For full release notes and details on each version, see the [GitHub Releases page](https://github.com/smcneece/solar-sentinel/releases).

## v2026.06.8 - June 8, 2026

- Fixed sun arc showing today's sunrise, sunset, dawn, dusk, and solar noon when viewing a past date; times (and moon phase) are now computed for the selected date using the installation's latitude/longitude read from HA's config; today still uses the live sun.sun entity for accuracy; falls back to live values if HA does not expose coordinates (thanks @sg1888)
- Fixed panel detail history chart showing misleadingly low power values in the 6-month and 1-year views; those ranges use daily statistics buckets, and the daily mean averages in all nighttime hours at 0W, dragging apparent peak output down to roughly a third of actual capacity; the 6m and 1y views now plot the daily maximum instead, matching the peaks visible in the 7d, 30d, and 90d views

## v2026.06.7 - June 7, 2026

- Fixed panel colors in history/slider mode not respecting the "Peak panel output (W)" setting; the live view gets colors from the server which applied the setting correctly, but the client-side recalculation used for history scrubbing kept a hardcoded 150W relative-average formula instead of the absolute threshold formula the server uses; both paths now use the same calculation
- Fixed battery SoC chart (Today view) line stopping at the last HA-recorded state change; when a battery sits at a constant SoC (e.g. 100% while idle), HA does not log further state changes, so the chart line appeared to freeze; the chart now extends a flat line to the current time using the last known SoC, advancing on each refresh cycle
- Fixed grid import/export chart not refreshing during the live update cycle; the production chart updated correctly but the grid chart was missing from the refresh loop entirely and only updated when switching tabs or dates
- Fixed panel grid layout briefly jumping between the auto-fitted size and the aspect-ratio fallback on every slider tick; the initial load stability check (which waits for the sun arc to render before locking in cell dimensions) was re-running on each slider update because the grid DOM is rebuilt on every render; the check now runs only once on initial page load
- Fixed panel name text being cut off after the first word in the positioned grid view; a browser rendering quirk caused the name element to shrink narrower than its container when using webkit line-clamp inside a flex column, so only the first word fit before the overflow clip; the name now correctly spans the full card width; landscape panels stack content from the top so the name is always visible before watts and kWh even when the card is short, while portrait panels keep vertical centering since they have ample height
- Fixed portrait panels in the layout editor appearing top-aligned instead of vertically centered; the portrait/landscape CSS class that controls alignment was applied in the view mode render path but missing from the editor render path

## v2026.06.6 - June 6, 2026

- Fixed "Peak panel output (W)" setting reverting to 300 every time Settings was saved; the value was being accepted by the UI but silently dropped by the server due to a missing allowlist entry; the setting now saves and persists correctly
- Panel colors now update immediately when Settings is saved instead of waiting for the next scheduled refresh cycle; useful when adjusting Peak panel output or min average threshold to see the effect right away
- Fixed total array wattage in the header not restoring to the live value when clicking the Live button after scrubbing through history; it now updates immediately without waiting for the next refresh cycle
- Debug info download now includes a client block with browser user agent, screen resolution, device pixel ratio, and window dimensions; useful for diagnosing display issues from bug reports
- Panel card text (name, wattage, kWh) now scales down on small screens where cells are genuinely cramped; scaling is suppressed when cells are large enough that the default sizes fit comfortably, so normal and large displays are unaffected

## v2026.06.5 - June 5, 2026

- Added "Peak panel output (W)" setting: set to the rated wattage of your panels (e.g. 300, 360, 400) and the color gradient will scale to your actual hardware instead of a fixed 150 W threshold; full orange maps to 95% of the rated value, reflecting real-world peak output since STC ratings are rarely achieved under normal conditions; default is 300 W; set to 0 to restore the automatic scaling based on array average
- Production chart "Today" view now renders as a filled area chart with a gradient fill and smooth line instead of hourly bars; grid chart "Today" view also converted to area chart; week/month/year views remain as bar charts since those show period aggregates
- Fixed cache busting not working for ES module sub-imports (state.js, panels.js, charts.js, etc.); previously only app.js itself was cache-busted on version update, while the modules it imports were served stale from the browser cache; all modules are now versioned via an import map in index.html so a hard refresh is no longer needed after updating
- Panel cards now have a subtle 3D raised appearance: a multi-layer box-shadow lifts each card off the background, and colored panels have a lighting gradient (brighter at the top, slightly darker at the bottom) that gives them depth; panel color updates now fade smoothly over 0.5s instead of snapping instantly
- Live indicator now pulses with a soft green glow when in live mode
- Added countdown timer next to the Live button showing seconds until the next data refresh; hidden when viewing history

## v2026.06.4 - June 5, 2026

- Fixed refresh interval minimum being inconsistent between the frontend (was 10 seconds) and backend (was 30 seconds); both now enforce 30 seconds as the minimum; added a 3600 second (1 hour) maximum on both ends; the Settings label now shows the valid range (30 - 3600 seconds)
- Panel grid now auto-fits to the viewport in view mode: cell size is calculated so the full grid fits on screen without scrolling in both X and Y; recalculates automatically on window resize; layout editor continues to scroll as before

## v2026.06.3 - June 3, 2026

- Fixed time slider broken (stuck, unresponsive, play does nothing) for users with long summer days where dusk falls late enough that the pre/post-dusk arc extension crosses midnight; most likely to affect users at higher latitudes (New York and further north) in summer months; the slider range calculation now adds the extension in minutes directly instead of converting a potentially next-day timestamp to local time

## v2026.06.2 - June 2, 2026

- Fixed "Last Reported" in the panel detail modal showing a relative duration (e.g. "5 days ago") calculated against the current clock, which was misleading when viewing historical data; it now shows the actual timestamp (e.g. 6/2/2026 11:49 AM) in both live and historical modes
- Added "Show W unit on panels" toggle in Settings; when disabled, panel cards show just the number without the unit suffix, which saves space on small screens
- Fixed time slider position not matching the sun ball position on the arc: the slider now spans only the visible arc window (pre-dawn to post-dusk) instead of the full 24-hour day, so the slider handle tracks directly with the sun ball; jump-to-start and playback also begin at dawn instead of midnight
- Fixed layout editor drag-and-drop always placing panels by their top-left corner regardless of where on the card you clicked; the drag ghost image now anchors to the top-left as well so it is clear where the panel will land
- Fixed drop target highlight in the layout editor being nearly invisible against the warm orange panel colors; changed to a bright blue outline that is clearly visible at any panel brightness
- Updated layout editor instructions to explain the top-left corner placement behavior; increased instruction text size for readability
- Improved sun arc time markers: Dawn and Dusk now have a solid tick that straddles the horizon line, pointing up into the arc and down to the label, making it clear where each event falls on the timeline; labels are centered under their tick; Sunrise and Sunset reference lines are now solid and extend from the label text all the way down to the horizon instead of starting at the arc point
- Fixed battery operating mode displaying in ALL CAPS; mode strings are now converted to title case ("SELF_CONSUMPTION" becomes "Self Consumption") for readability across all battery integrations; added a small "(operating)" label with a tooltip clarifying this is the current firmware state, not the configured Battery Control Mode
- Added 0.5x playback speed to the timeline controls; speed button now cycles 0.5x, 1x, 2x and defaults to 0.5x for a slower initial scrub

## v2026.06.1 - June 1, 2026

- Added today and tomorrow weather display in the margins of the sun arc: date, condition icon, and low/high temperature; silently skipped if no weather entity is configured in HA; tested with National Weather Service (NWS), Met.no, and Pirate Weather; NWS uses a day/night forecast format that is handled automatically; OpenWeatherMap free tier is not supported as it does not provide daily forecasts via the standard HA interface; if your integration is not working open a GitHub issue and support will be added as long as the weather API key is free
- Fixed sun position marker on the arc appearing as an ellipse at non-standard browser widths; now uses a compensated ellipse that renders circular at any window size, matching the moon fix from v2026.05.7

## v2026.05.7 - May 29, 2026

- Added timeline playback controls: Jump to start (|◀), Play/Pause (▶/⏸), and 1x/2x speed toggle in the navigation bar below the sun arc; playback scrubs forward through the day automatically, showing panel history as it advances; stops at the current time for today or end of day for past dates
- "Invert battery power direction" toggle is now hidden in Settings when no battery system is configured in the Energy Dashboard
- Multiple batteries are now sorted alphabetically by name in the battery panel selector
- Fixed placed panels changing shape (portrait/landscape) when the browser window is resized: the panel grid now uses CSS aspect-ratio so cells scale proportionally in both dimensions; previously column width was responsive but row height was fixed at 24px
- Fixed drag-and-drop in the layout editor landing at the wrong position: panels now place so the point you clicked within the card aligns with the drop target, rather than the top-left corner always snapping to wherever you release
- Fixed moon icon in the sun arc appearing as an ellipse at non-standard browser widths: the SVG viewBox stretches horizontally but the moon was drawn as a circle in SVG units, causing it to squash or stretch; it is now drawn as a compensated ellipse that renders circular at any window width

## v2026.05.6 - May 28, 2026

- Fixed battery chart Today/Week/Month/Year buttons appearing as unstyled browser defaults instead of matching the UI
- Fixed battery charge/discharge direction inverted: Solar Sentinel's direction logic had the sign convention backwards relative to HA Standard (positive = discharging, negative = charging); all users with a battery power sensor configured in the Energy Dashboard were affected
- Battery discovery now reads HA's power_config.stat_rate_inverted field; if a battery power sensor is configured as "Inverted" in the HA Energy Dashboard (typically for a physically reversed CT clamp), the direction is corrected automatically
- Added "Invert battery power direction" toggle in Settings as a manual fallback for any integration where charging still shows as discharging after updating
- Added multiple battery support: if more than one battery system is configured in the HA Energy Dashboard, selector buttons appear at the top of the battery panel to switch between them; batteries are sorted alphabetically by name; the battery chart follows the selected battery

## v2026.05.5 - May 27, 2026

- Added battery panel: if a battery source is configured in the HA Energy Dashboard, a Battery tab appears in the left panel alongside Grid; shows current SoC %, charge/discharge direction with live power, operating mode, and today's kWh charged in/out; chart has four views: Today (SoC % line for the full 24-hour window), Week/Month/Year (charged vs. discharged kWh as grouped bars); if only battery is present with no grid sensors, it shows directly without tabs
- Added "Strip from panel names" setting: enter a comma-separated list of words or phrases to strip from all panel display names; display only, nothing is renamed in HA; useful for integrations that prefix every panel name with the integration name or device type
- Added "Show names on panels" toggle in Settings: hides panel name text on cards in the live view; names are always shown in the layout editor regardless of this setting so you can still identify panels while placing them
- Settings toggles (Show grid chart, Show names on panels) converted from checkboxes to toggle sliders
- After an HA restart, Solar Sentinel now retries automatically every 30 seconds for up to 5 minutes when all panels are unavailable, rather than waiting the full refresh interval; reduces the time panels show as offline after an integration reconnects
- Fixed minimum array average (W) threshold not being applied when scrubbing through history with the time slider; panels near sunrise or sunset could show colored wattage values below the threshold instead of suppressing to gray and 0 W
- Renamed "Copy Debug Info" to "Download Debug Info": now downloads a JSON file (solar-sentinel-debug.json) instead of copying to clipboard; easier to attach directly to a GitHub issue and works reliably on all browsers
- Added version-based cache busting for CSS and JS assets; browser cache is cleared automatically on version updates without requiring a manual hard refresh
- Added color legend bar between the panel grid and the arc: a narrow gradient strip showing LOW (gray) through pale yellow to dark orange (HIGH), centered above the arc card so users can read the panel color scale at a glance
- Panel color gradient: replaced the three-state green/yellow/red system with a smooth warm gradient (pale yellow to dark orange); color reflects both relative performance within the array and absolute production level so panels at dawn or dusk appear pale regardless of relative rank, while panels at full daytime output show rich orange; shaded or underperforming panels appear noticeably lighter than their neighbors
- Panel detail modal now shows historical sensor values when the time slider is at a past time: power, voltage, current, temperature, and other device sensors reflect the values at the selected timestamp instead of current live readings; a "Historical: HH:MM" label appears at the top of the details tab to indicate the data is not live

## v2026.05.4 - May 25, 2026

- Added grid import/export chart: a new panel to the left of the sun arc shows grid energy import and export as a stacked bar chart with Today/Week/Month/Year views and a total kWh label; requires grid sensors configured in the HA Energy Dashboard; can be toggled on or off in Settings
- Added hover crosshair and tooltip to the production chart: mousing over a bar shows a vertical crosshair line and a tooltip with the time period and kWh value
- Chart bars now use rounded top corners to match HA Energy Dashboard style
- Moon phase icon terminator shape corrected: was appearing egg-shaped due to a too-flat ellipse; now renders with a more realistic curve and is clipped to the moon disc so the lit area cannot extend outside the circle
- Fixed grid chart not updating when the date picker is changed to a past date; now refreshes alongside the production chart
- Added Copy Debug Info button in Help/About: copies a JSON snapshot of the Energy Dashboard config and associated entity states to the clipboard; intended for issue reporting
- Refactored frontend into ES modules (state.js, utils.js, arc.js, charts.js, panels.js, layout.js, app.js); no user-visible change, but makes the codebase significantly easier to maintain and extend
- **After updating, do a hard refresh (Ctrl+F5) in your browser** to clear cached JS files and see the new charts

## v2026.05.3 - May 24, 2026

- Added panel-equivalent count label to the layout editor toolbar (e.g. "4 x 16 panels") so fine grid dimensions are easier to understand; updates live as grid is resized
- Added Reset Layout button in the layout editor (left of Save Layout) with a confirmation modal; resets the grid to the 4x16 panel default and moves all panels and labels to the unplaced area
- Added Default: Landscape / Default: Portrait orientation toggle next to the unplaced bank label; sets the rotation applied when dragging panels from the bank to the grid; the tray visually updates to show panels at the selected shape so you can see the orientation before placing
- Fixed unplaced bank panels displaying as squares; now shown at the correct landscape or portrait aspect ratio with a fine grid overlay (4x3 or 3x4 cells) so you can see how each panel will occupy the grid
- Raised minimum refresh interval from 10 to 30 seconds to avoid excess load on slower HA hardware
- Removed the 300-second upper cap on the refresh interval setting; no maximum is now enforced

## v2026.05.2 - May 23, 2026

- Added hover tooltip on production chart bars showing label and kWh value
- Added Export and Import Layout in Settings for transferring panel layouts between HA instances
- Added section labels: click "+ Label" in the layout editor to place a draggable text box on the grid; labels auto-expand width as you type and are visible in both edit and view modes
- Added insert row (↑) and insert column (←) toolbar buttons; inserts one fine row or column at the top or left edge and shifts all panels and labels to make room
- Layout editor now uses a fine grid (4x3 fine cells per panel) for sub-panel-width placement precision
- Added panel rotation: double-click a placed panel in the editor to toggle landscape/portrait orientation
- Added overlap prevention: drops that would partially overlap an adjacent panel are rejected
- Changed row/col +/- buttons to step one fine grid cell at a time for precise grid sizing
- Changed default refresh interval from 30 seconds to 5 minutes
- Added "Settings" label under the gear icon in the header
- Panel names now wrap to two lines in the card instead of truncating with ellipsis
- Panel card content is vertically centered for better appearance in portrait-rotated cards
- Fixed two panels with the same displayed wattage showing different colors due to sub-watt float differences
- Fixed panels becoming unreachable as drop targets immediately after being moved
- Fixed bank panel disappearing when dragged and dropped back onto the unplaced bank
- Graph paper grid lines now show only in edit mode; view mode shows panels on a clean background
- Split frontend into index.html (skeleton), app.css, and app.js for maintainability; no user-visible change

## v2026.05.1 - May 22, 2026

Initial public release.
