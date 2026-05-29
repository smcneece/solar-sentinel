# Changelog

⭐ If Solar Sentinel is useful to you, consider starring the repo on GitHub so other HA users can find it. It takes two seconds and makes a real difference.
[Star Solar Sentinel on GitHub](https://github.com/smcneece/solar-sentinel)

For full release notes and details on each version, see the [GitHub Releases page](https://github.com/smcneece/solar-sentinel/releases).

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
