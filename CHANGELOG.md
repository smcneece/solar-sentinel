# Changelog

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
