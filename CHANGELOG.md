# Changelog

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
