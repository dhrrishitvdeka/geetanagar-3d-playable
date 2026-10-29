# World reconstruction and detail pass

Updated 29 October 2026.

## Reference and limits

The model uses the existing traced footprint/terrain/road data and recorded March 2026 street surveys. During this pass, Google Maps Street View was inspected directly at Hatigarh Chariali, including the tower building, neighbouring shopfronts, corrugated awnings, projecting boards, utility wires, traffic island and roadside parking.

- [Hatigarh junction, southwest view](https://www.google.com/maps/@?api=1&map_action=pano&pano=9Yn0U7qxM9dqWNLUej2-3g&heading=215&pitch=0)
- [Hatigarh shopfront detail](https://www.google.com/maps/@?api=1&map_action=pano&pano=9Yn0U7qxM9dqWNLUej2-3g&heading=225&pitch=0&fov=40)
- Existing position and confidence records: `data/road_features.json`, `data/buildings_overrides.json`, and `data/landmarks.json`.

The Street View display identifies the imagery as March 2026. It does not establish the current tenant, exact dimensions, or the appearance of every building. The original survey also records a camera-to-road offset, so this pass retains the local road frame rather than blindly moving geometry to panorama coordinates.

This is a detailed reconstruction, not a surveyed digital twin. No Google images were copied into game textures. Business names that were unreadable were not invented or marked verified. Generic shop labels and procedural stock remain part of the game; storefront category and merchandise are not a claim about the real tenant.

## Implemented

- Surveyed pink slab edges, maroon trim, orange trim and red parapets now have explicit building overrides instead of falling back to random palette choices.
- Six surveyed shop buildings have stable board/awning profiles in `data/storefront_profiles.json`. These keep the blue-banner single-storey row, muted grey-green junction canopy, and nearby distinct facade palettes consistent with the available references.
- Surveyed shopfronts use weathered boards, layered small boards where recorded, shutter guides and canopy supports. Existing SBI signage remains separate.
- New footpath slab joints and inset metal drain-cover details follow the existing road and raised footpath geometry. Dust deposits and small asphalt-edge chips break up large flat surfaces.
- Surface details skip crossings, lane mouths, speed breakers and ramps. They add no obstacles or collision geometry.
- Detail density scales with quality. High adds approximately 8,264 street-detail vertices before static merging; Low adds approximately 3,004. No full-frame GPU performance claim is made from those geometry counts.
- Correct roof winding restores upward surface normals, and radius-aware collision lookup plus short movement steps keep the player, vehicles and explorer from stepping through thin walls at lower frame rates.

## What remains estimated

Exact shop identities, opening states, sign typography, bay dimensions, most interiors, individual pavement joint positions, drain-cover positions and wear patterns remain estimates. The new surface details are procedural and explicitly do not represent a fresh survey of each cover or crack. Four of the storefront profiles primarily use the existing survey notes rather than a new independent visual match.

Further exact reconstruction should use a frontage-by-frontage reference set with building IDs, direction, date and readable signs, followed by matched-view comparison. The schema now allows those profiles to be refined without replacing the whole neighbourhood or moving its traced roads.

See `CREDITS.md` for the existing asset and data provenance records, including unresolved entries.

## Wider Geetanagar surroundings pass

The next pass extends the structural treatment beyond the Hatigarh/main-road shopfronts. Two additional March 2026 Street View references were inspected directly:

- [Railway Colony Road, looking north](https://www.google.com/maps/@?api=1&map_action=pano&pano=g05NzMkFPBU4xEBxv5OuGg&heading=355&pitch=0): mixed concrete houses, tin veranda/stall roofs, worn drain edges, boundary walls and overhead services.
- [Park forecourt, looking south](https://www.google.com/maps/@?api=1&map_action=pano&pano=3_qRnWZanWudTCw74Lodrw&heading=180&pitch=0): two blue kiosks beside an open concrete-roofed pavilion, with the park fence and tower behind.

The park reference corrects the earlier tin-roof interpretation for the tea shelter. The replacement models the concrete roof slab, low parapet, columns, shaded soffit, damp base, paper remnants and interior worktop. Its dimensions and fixtures are estimates, and the existing game character/shop identity remains fictional. It retains the original interaction position and an open customer approach.

Elsewhere, connected service assemblies follow actual rendered house walls and roofs: downpipes connect to scuppers or eaves, clamps follow the pipe, meter conduits terminate at boxes, and selected condensers have supports and drain lines. Candidate placements reject adjacent footprints, street/field/park classes and steep ground. They are regional construction detail rather than observations of those specific services on each house.

Lane details extend existing inferred drain runs and use the terrain to select low retaining edges. Existing open gates guide shallow driveway lids. They add no new collision barriers; road mouths and walkable approaches are kept open. Surface wear and joint positions remain procedural.

Beyond the traced boundary, distant houses now form coherent aligned groups with conservative spacing, stepped upper floors, parapets and pitched tin roofs. **Those peripheral alignments are procedural scenery, not additional surveyed roads or exact Guwahati building locations.** The existing DEM-derived hills and traced-area exclusion remain in place. Houses and trees use stable nested quality subsets, and the peripheral house geometry is limited to sixteen instance batches.

The explorer now offers Railway Colony Road, Karbi Path, Talukdar Road and Faculty School hill as starting locations. The first three use centerline samples already present in the road dataset; the hill option uses the existing school location.
