# Aircraft models (Blender, procedural)

`build_aircraft.py` models every aircraft in Sky Fury from code and writes
plain glTF 2.0 binaries to `public/models/`. The meshes are original and
procedural: no imported or downloaded meshes, and no insignia, flags, seals,
text, or airline or government markings.

| file | what | tris | draw calls | size (L x span x H) |
|---|---|---|---|---|
| `fighter_player.glb` | player / Viper 2: light grey, neon-cyan stripes | 1494 | 9 | 15.0 x 10.1 x 4.0 m (flame to 18 m) |
| `fighter_bandit.glb` | bandit: charcoal, red wingtips, fin flash, intake lips | 1494 | 9 | same airframe |
| `fighter_ace.glb` | named ace: black with gold | 1494 | 9 | same airframe |
| `bomber.glb` | four-engine swept shoulder-wing bomber, dark grey | 1946 | 3 | 47.6 x 48.1 x 12.4 m |
| `transport.glb` | twin-engine VIP airliner, white over deep blue | 1466 | 3 | 40.4 x 36.4 x 12.5 m |

## Rebuild

```sh
# Blender 5.x as a Python module (pip "bpy"), or: blender -b -P build_aircraft.py -- <args>
python scripts/blender/build_aircraft.py                         # all five -> public/models/
python scripts/blender/build_aircraft.py --only bomber transport
python scripts/blender/build_aircraft.py --previews /tmp/previews # also Cycles PNGs + a sheet per file
```

The build is deterministic: the same script produces byte-identical GLBs.
After each export it re-reads the GLB and fails if it finds any glTF
extension, a texture over 64 px, or a triangle count over budget. It prints
the triangles, primitives, nodes and size of every file.

## Axes and Cesium options

- **Exported:** glTF **+X = nose, +Y = up, +Z = right wing**. Units are metres. The origin is on the fuselage centreline at about mid-wing; the nozzle exit is at x = -7.0 on the fighters.
- **Load with:** `Cesium.Model.fromGltfAsync({ url, upAxis: Cesium.Axis.Y, forwardAxis: Cesium.Axis.X, incrementallyLoadTextures: false })`.
  - Cesium's default `forwardAxis` is Z, so it must be set to X or the jet flies sideways.
  - `upAxis` Y is already the default.
  - Without `incrementallyLoadTextures: false`, a new model is drawn white for a few frames until its palette PNG has decoded.
- **Model frame after loading:** x = nose, y = left wing, z = up. This is Cesium's own convention, so heading/pitch/roll and `VelocityOrientationProperty` work as they are.
- **The game's body frame** (`computeBodyFrame`: x = right, y = forward, z = up) needs one fixed turn of +90 deg about z:

  ```ts
  const MODEL_TO_BODY = Cesium.Matrix4.fromRotationTranslation(Cesium.Matrix3.fromRotationZ(Math.PI / 2));
  Cesium.Matrix4.multiply(Cesium.Matrix4.fromRotationTranslation(bodyRot, bodyPos), MODEL_TO_BODY, model.modelMatrix);
  ```

## Named nodes (fighters)

Every moving node's origin sits on its hinge line. To deflect a surface,
multiply its rest matrix by a rotation about the axis listed below:
`node.matrix = Matrix4.multiply(node.originalMatrix, Matrix4.fromRotationTranslation(Matrix3.fromRotationZ(a)), new Matrix4())`.

| node | pivot (glTF x, y, z) | deflect about | positive angle |
|---|---|---|---|
| `Flaperon_L` / `Flaperon_R` | (-2.93, 0.08, -/+2.20) | local Z | trailing edge down |
| `Stab_L` / `Stab_R` (all-moving) | (-5.55, 0.05, -/+0.62) | local Z | trailing edge down |
| `Rudder` | (-6.05, 1.975, 0) | local Y | trailing edge to the right |
| `Afterburner` | (-7.0, 0, 0), the nozzle exit | scale local X | longer flame (it extends along -X) |
| `NavLight_L` (red) / `NavLight_R` (green) | wingtip leading edge | show / hide or scale | |

The parts are:

- **Static:** the airframe is one `Body` node under the root `Jet`.
- **Emissive:** `Afterburner` and the nav lights use the emissive `Glow` material. The flame is a white-hot to red gradient taken from the palette.
- **Bomber and transport:** `Body`, `NavLight_L` and `NavLight_R` under `Bomber` / `Transport`.

## Budget and format rules (iPhone Safari)

- **One 32x32 PNG palette per file**, an 8x8 grid of 4x4 swatches sampled with nearest filtering. Row 5 holds a repeating cabin-window strip; row 7 is the afterburner gradient.
- **Two materials, both on that same image.**
  - `Paint` (metallic 0, roughness 0.5) takes the palette as its base colour.
  - `Glow` (black base) takes it as its emissive texture.
- **Liveries are palette-only.** The three fighter files have identical geometry and UVs; only the PNG differs.
- **One draw call per primitive.** Fighters have 9 primitives and the bomber and transport have 3. There is no per-frame geometry rebuild.
- **No Draco, no meshopt, no KTX2/Basis.** Those are decoded in Cesium web workers. A plain GLB loads on the main thread. A headless test confirmed that loading these files creates no worker, schedules no TaskProcessor task and requests nothing under `/cesium/Workers/`, even when every worker download is made to fail.
- **Closed shapes.** Every mesh island is closed (0 non-manifold edges), normals point outward and smooth shading breaks at 40 deg. Movable surfaces keep a 3 cm gap from the fixed structure, so nothing is coplanar and nothing z-fights.
