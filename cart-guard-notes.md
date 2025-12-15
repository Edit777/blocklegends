# Cart Guard reference and current issues

## Current implementation overview
- **Scope:** `bl-cart-guard.js` treats add-on lines as those where any of the following match:
  - Line-item property `_bl_is_addon` equals `'1'` (preferred signal).
  - The cart item handle matches `addonHandle` (default `mystery-add-on`).
  - The cart item URL contains `/products/mystery-add-on`.
- **Key configuration defaults:**
  - `addonHandle: 'mystery-add-on'`
  - `propIsAddon: '_bl_is_addon'`
  - `propParentUid: '_bl_parent_uid'`
  - `propParentHandle: '_bl_parent_handle'`
- **Rules enforced for add-ons:**
  - An add-on cannot exist without a valid parent. If an add-on line has no `_bl_parent_uid`, or the cart has no non–add-on line with that `_bl_parent_uid`, the add-on line is removed.
  - Only one add-on line is allowed per parent UID. If the add-on count exceeds `maxAddonsPerParent` (default `1`), the extra add-on lines are removed.
  - Add-on quantity is forced to `1`; if an add-on line has `qty > 1`, it is set back to `1`.
- **What Cart Guard does not currently handle:** it does **not** synchronize add-on quantity with parent quantity. The enforcement is limited to “one add-on line per UID and that add-on line qty = 1.”

## Enforcement algorithm
`BL.cartGuard.cleanup(reason)` fetches `/cart.js`, builds a `parentsByUid` map from non-add-on lines that have `properties['_bl_parent_uid']`, then iterates add-on lines and queues changes:
- If the add-on is missing its UID or a matching parent, it is removed (`qty = 0`).
- If `_bl_parent_handle` exists and does not match the parent handle, the add-on is removed.
- If more than one add-on exists for the same UID, extras are removed.
- If an add-on quantity is above `1`, it is reset to `1`.

Changes are applied sequentially through `POST /cart/change.js` with `{ id: lineKey, quantity: qty }`. Cart Guard uses an internal `G.__busy` lock to avoid overlapping cleanup runs.

## Triggers
Cart Guard schedules `cleanup()` after cart mutations via patched `fetch`/`XMLHttpRequest`, listens for common theme cart events, observes cart-drawer DOM mutations, guards checkout clicks, and runs on init/visibility.

## Dependencies
- `bl-core.js`: provides the `BL.utils` logging utilities (debug enabled via `?bl_debug=1` or `localStorage BL_DEBUG=1`).
- `bl-init.js`: calls `BL.cartGuard.init()` on `DOMContentLoaded` and `shopify:section:load` if Cart Guard is present.
- `bl-parent-uid.js`: injects the linking properties (`_bl_parent_uid`, `_bl_parent_handle`, `_bl_is_addon`, `_bl_locked_collection`) into the parent and add-on forms during submission.
- `bl-upsells.js` / `bl-mystery-addon.js`: render the add-on UI and mark selections consumed by `bl-parent-uid.js`.

## Known incorrect behavior
The current implementation is malfunctioning:
- Adding a parent product with an add-on works once, but a second attempt only adds the parent. The system prevents having two add-ons at the same time, even when the add-ons are different variants tied to the same parent.
- Parent and add-on lines should be allowed to stack as long as the parent quantity matches the total add-on quantity, but Cart Guard currently blocks this scenario.
- Changing quantity with increment/decrement controls often causes the add-on line to be deleted unexpectedly.

These symptoms suggest the cleanup logic is overly aggressive, so add-on stacking and synchronized quantity adjustments need investigation.
