# Spaced
A space editor for the Good Game Folks platform (https://github.com/ggfolks/platform).

## Configuring Electron application
If you're running the Electron version of the editor (that is, you've installed it on your local
machine), be sure to configure it with the root directory of the project you'll be working on.
Open the Preferences dialog from the Edit menu and click the ⋮ button next to the rootDirectory
field, then select the "dist" directory under your cloned copy of the project's Git repository.
This will ensure that all URLs are stored and resolved relative to that directory.

## Interface
The interface consists of a menu bar, a set of page tabs directly under the menu bar, a tree view
on the left side of the window, a 3D view in the middle of the window, and a component view on the
right side.

### Page tabs
Each space is divided into a set of separate pages, much like the pages of a spreadsheet.  The
initial "default" page cannot be deleted or renamed.  To create a new, empty page, use the + button.
Rename pages by double-clicking on the page name, typing a new name, and pressing enter.  Reorder
pages by dragging their tabs; as you drag, the white line indicates the new position of the tab.
Delete pages by clicking the × button next to the page name.

### Tree view
The tree view has two tabs: objects and catalog.

#### Objects tab
The Objects tab shows the names of all objects on the current page, arranged by transform hierarchy.
As with the pages, you can double-click on an object name to change it.  Names need not be unique.
Objects with children will have an expansion arrow (▾ if expanded, ▸ if not) that you can click to
show/hide the node's children.

Click objects to select them.  Control-click to select multiple objects at a time.  Shift-click to
select ranges of objects.  Drag objects to reorder or reparent them.  Click anywhere on the tree
view aside from an object to deselect.

#### Catalog tab
The Catalog tab shows the entries in the currently selected catalog.  To select (or create) a
catalog, open the Preferences dialog from the Edit menu and either press the ⋮ button to select
an existing catalog or type in the path of a new catalog to create (relative to the root directory).
When no catalog is configured, the Catalog tab will be invisible.

To save selections to the catalog, select them (with the Objects tab active) and select Save to
Catalog from the Selection menu.  This will create and select a new entry at the top level of the
catalog.  As with the Objects view, entries may be renamed by double-clicking and
reparented/reordered by dragging and dropping.  Similarly, Delete deletes entries (with
confirmation).  However, undo/redo and cut/copy/paste do not apply to the catalog.

The catalog is saved automatically, five seconds after the last edit to it and whenever the space
itself is saved.

When a catalog entry is selected, a translucent view of the entry will appear under the mouse
cursor in 3D view.  Use the mouse wheel to adjust the rotation of the entry.  Hold shift for fine
positioning (otherwise, the position will be snapped to the grid and the rotation to multiples of
90 degrees).  Press the mouse button to "stamp" out a copy of the entry into the space.  Hold the
control key to temporarily switch to camera mode.

### 3D view
The 3D view shows the current page with a reference grid.  Selected objects will appear outlined
in white; unselected hovered objects will appear with gray outlines.

The camera follows a simple orbit model, circling around a target point on the grid.  Press and drag
the left mouse button to rotate about the target.  Press and drag the middle mouse button (or use
the mouse wheel) to move the camera towards or away from the target.  Press and drag the right
mouse button (or use the arrow keys) to pan the camera on the X/Z plane.  Use the PgUp/PgDn keys
to raise/lower the reference grid (and thus the camera) by one unit at a time.

To select an object, hover over it (at which point it should appear outlined in gray) and click on
it (at which point the outline will turn white).  To select multiple objects at once (or deselect),
hold down the control key.  To select a group of objects by dragging out a rectangle on the
reference grid, hold down the shift key, press, and drag.  Note that if you start the rectangle on
an object, this will move the object rather than initiating a group select.  To avoid this, you can
hold down control *and* shift to avoid interacting with the object under the cursor.

In general, the editor snaps positions unless you hold down the shift key.  For example, you can
press and drag an object to move it around, and by default it will align to grid coordinates.  For
fine positioning, hold down shift while dragging.  Similarly, using the mouse wheel while hovering
over an object will rotate it in 90 degree increments, but you can hold down the shift key to switch
to one degree increments.

### Component view
Objects themselves are simply containers for components.  The component view on the right side of
the interface shows the components contained in the object (including the undeletable transform
component).  If multiple objects are selected, the view shows the components shared by all of the
objects (and any edits are applied to all selected).  You can use the transform component view to
adjust the position, rotation, and scale of objects.  For numeric fields, you can hover over the
field and use the mouse wheel to increase or decrease the value.

Drag components to reorder them and click the × button next to the component's name to delete them.
You can add new components to selected objects either by using the "Add Component" dropdown in the
component view or the "Component" menu in the menu bar.

## Tile model
To build complex environments, load tile models and fuse them together to create larger structures.
To add a tile to the space, select Tile from the Object menu and use the ⋮ button next to the URL
field in the model component to select the model to load for the tile.  The tile component will
attempt to determine the tile dimensions from the model bounds, but you may have to adjust them by
manually editing the min and max fields if the (rounded) model bounds don't match the logical
extents of the tile.  If the tile can be walked upon (i.e., it is a floor tile), be sure to click
the walkable checkbox.

Once you've loaded a tile, you can copy and paste it to create multiple instances.  Once you have a
set of tiles arranged the way you like, you can select them all and use the Fuse command under the
Selection menu to fuse the tiles together into a single object.  The corresponding Explode command
turns a fused object back into its constituent tiles.

In the game, characters can only walk on locations covered by walkable tiles that aren't also
blocked by non-walkable tiles.  Nothing prevents multiple tiles from occupying the same location.
