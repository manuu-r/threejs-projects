# Roadster Lab asset provenance

## Custom project assets

The cockpit and interpretive vehicle geometry are created for this project in Blender. They are an educational reconstruction informed by publicly visible references, not a manufacturer CAD model or an exact dimensioned replica. The final cockpit proportions, driver eye position, instrument content, animated controls, and any hypothetical flight interface are project design choices. The main implementation owns the modeling script and exported asset inventory; consult `art/` and `public/assets/` for the files actually delivered.

The fictional proving-ground environment, lesson markers, runway layout, and procedural materials are project-created. No downloaded commercial vehicle model is used. If a third-party model or texture is added later, record its author, original URL, license, download date, modifications, and attribution requirements in this document before distribution.

## Visual references

The current reference is the white Roadster described on [Tesla’s live Roadster page](https://www.tesla.com/roadster), inspected 16 October 2026. Older red-concept imagery is not treated as the current production layout.

- [Official interior image, “Supersonic” carousel slide](https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-03-Carousel-Slide-4-Mobile.jpg). Tesla, viewed 16 October 2026. Used to study the dashboard, yoke, seating, windshield frame, and material relationships. The image is photographed behind the seats; driver-eye geometry must be inferred.
- [Official exterior image, “Hidden Aero” carousel slide](https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-03-Carousel-Slide-1-Mobile.jpg). Tesla, reference identified on the live page 16 October 2026. Any new exterior mesh remains an interpretation.

Tesla retains rights to its photographs, names, and marks. Linking a reference does not grant a reuse license. The simulation should distribute its own reconstructed geometry and avoid presenting manufacturer photography as an original project asset. No Tesla or SpaceX endorsement is implied.

## Research sources

See [RESEARCH.md](RESEARCH.md) for primary engineering sources, the dated distinction between published details and assumptions, and limitations of the reconstruction. NASA’s general propulsion references are educational sources; they are not evidence of Roadster-specific hardware or performance.

## Delivered asset inventory

- `public/assets/vehicle.glb`: original exported model, with sculpted dashboard, yoke, three display housings, seating, glass, body, wheels, brake hardware, and interpretive nozzles. Runtime instrument graphics are original canvas drawings.
- `art/build_cockpit.py`: reproducible Blender authoring script. `art/prototype-source.blend` is the locally saved editable source (ignored by Git); the script and portable GLB are the reproducible handoff.
- `art/cockpit-qa.png`, `art/exterior-qa.png`: Blender visual checks. These are asset renders, **not screenshots of the browser game**.
- `art/official-exterior-reference.jpg`: a local copy of Tesla's linked photograph for private modeling study, excluded from Git and from the published runtime assets. It is not used as a website hero or texture.
- Procedural asphalt, grain, sand, sky, scenery, instrument graphics and synthesized audio are generated locally by the app. The app loads its bundled lighting map locally; no third-party asset service is contacted at runtime.

Three.js and cannon-es are MIT-licensed dependencies; their package notices remain in the dependency distribution. The scene is inspired by a named product, and the original geometry is an approximation of visible design features, not supplied manufacturer geometry. Rocket seating keeps the inferred driving position and omits the passenger seat; the exact Rocket seating layout remains unknown.


## October 16 visual revision

Additional private Tesla references, inspected at their native resolution:

- [Rear-quarter paint and surface creases](https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-03-Carousel-Slide-2-Mobile.jpg).
- [Overhead glazing, bonnet and door openings](https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-03-Carousel-Slide-3-Mobile.jpg).
- [Rear canopy, tailbar and four horizontal outlets](https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-01-Hero-Mobile.jpg).

These private study files in `art/references/` are excluded from Git and the published build. The revised mesh is original. It models visible design relationships, with inferred underside hardware, panel depths, dimensions and control pivots. Its aerodynamic deployment is an illustration, not a reproduction of Tesla controller behavior.

## Bundled lighting asset

`public/assets/sky-lighting.hdr`: **Kloofendal 48d Partly Cloudy (Pure Sky)**, original by Greg Zaal, sky edits by Jarod Guest, from [Poly Haven](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky). Downloaded 16 October 2026 from its official 1K HDR distribution; renamed only, no pixel modifications. [CC0 license](https://polyhaven.com/license), redistribution and commercial use permitted; attribution appreciated but not required. The downloaded file's MD5 is `c69498687e876bf68d2a8b8a62234eb9`. Used for material lighting/reflections, with a separate procedural sky background.


## User-reference and unbadged revision — 17 October 2026

The user supplied front three-quarter, rear/doors and interior reference images. Private copies are retained as `art/references/user-front.png`, `user-rear.png` and `user-interior.png`; they are excluded from Git and from the application build. They informed the curved canopy, broad shoulders, closed daytime lamp covers, five-blade wheels, unbadged yoke, restrained red door trim and central-screen layout. The mesh remains an inferred reconstruction, not measured CAD.

The published experience contains no manufacturer badge, full vehicle name or manufacturer-name presentation. Generic mode labels are Road, Boost and Flight. The original source-specific study remains in `docs/RESEARCH.md` with attribution intact. Its former public copy has been replaced by brand-neutral `public/notes.md`; private study images are never runtime textures. Public geometry is `public/assets/vehicle.glb`; reproducible source is `art/build_cockpit.py` plus `art/exterior_shell.py`, with the local editable scene saved as `art/prototype-source.blend`.
