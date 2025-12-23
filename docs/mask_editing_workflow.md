# Mask Editing Workflow (Base + Mask + Edit Spec)

## Goal

Provide reliable image editing without marker artifacts by separating:

- Base image: clean original reference image.
- Mask: black/white (or alpha) edit region(s).
- Edit spec: text instructions tied to regions.

This prevents marker pixels from leaking into generation output while keeping edit intent.

## Data Model

- Base image (data URL) used as the primary visual reference.
- Regions (array):
  - id (string, e.g. "1")
  - color (UI only)
  - instruction (text)
  - maskDataUrl (white=editable, black=locked)
- Merged mask (union of regions) for single-pass generation.

## UI Model

- Marker tool creates a new region id (1,2,3...).
- Brush/box draw into the active region mask (not on the base image).
- Marker labels render on a dedicated marker layer for visibility only.
- Rectangle labels use a compact corner number (shared sequence with markers).
- Arrow/text annotations do not create numeric markers.
- Arrow/text annotations render on a separate annotation layer (not in the mask).
- Text annotations append into the active region instruction (or create a region at click).
- Region list lets users enter instructions per region.

## Generation Flow

Single-pass edit (current target):

1. Base image = Image 1
2. Merged mask = Image 2
3. Prompt = user prompt + compiled region instructions
4. Instruction block tells model:
   - Only modify white areas in mask
   - Keep everything else unchanged

Multi-region masks are preserved for future multi-pass editing.

## Planned Implementation Notes

- Replace composite reference image with base image.
- Export per-region masks and a merged mask.
- Save region instructions in params.
- Append edit spec to prompt during generation.

## Implementation Status

- Canvas editor now exports base image, merged mask, and per-region masks.
- Regions are stored with instructions and passed through generation params.
- Generation prompt includes an explicit edit spec block and uses base+mask as references.
- Arrow and text annotation tools are supported in the editor UI.
