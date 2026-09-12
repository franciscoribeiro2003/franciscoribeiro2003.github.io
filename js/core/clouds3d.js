/**
 * Volumetric clouds as real 3D geometry, drawn as a MapLibre custom layer.
 *
 * Sprites were the previous attempt and they were flat: `icon-pitch-alignment:
 * map` lays a billboard on the surface like a decal, so tilting the globe
 * showed a sticker rather than a body, and each sprite's fixed silhouette read
 * as a peanut from every angle.
 *
 * Here every cloud is a cluster of ellipsoid puffs positioned in 3D above the
 * sphere. Rotating the globe moves the near puffs across the far ones, the
 * shading changes with the viewing angle, and clouds occlude each other — the
 * things that actually make something look three-dimensional.
 *
 * Cost is one instanced draw call. The puff mesh is a twice-subdivided
 * octahedron (128 triangles) and there are a few thousand instances, so this
 * is a few hundred thousand triangles a frame: unremarkable for a GPU, and
 * nothing is uploaded per frame.
 *
 * The projection comes from MapLibre's own shader prelude — `projectToSphere`,
 * `globeGetRotationMatrix`, `globeComputeClippingZ` and the `u_projection_*`
 * uniforms — so the geometry sits on the globe exactly where the map's own
 * layers do, in whatever projection state the map is in.
 */

/* --- stylised scale ------------------------------------------------------- */

/**
 * Clouds are deliberately far larger than real ones. A 5 km cumulus is
 * sub-pixel at globe zoom, which would be physically right and visually
 * useless. These are the numbers that make cloud read as cloud when the whole
 * of Europe is on screen.
 */
/**
 * At globe view the sphere spans roughly 600 px, so one pixel is about 20 km.
 * The lower bound exists to keep the smallest detail lobes above a pixel — an
 * earlier setting bottomed out at 3 km radius, which is a seventh of a pixel
 * and simply invisible. The upper bound leaves room for the distance-driven
 * scale, which reaches about 3.3x deep in the unknown.
 */
const PUFF_RADIUS_KM = [70, 480];
const CLOUD_ALTITUDE_KM = [30, 55];
/** How far the puffs of one cloud spread from its centre. */
const CLUSTER_SPREAD = 1.35;
const PUFFS_PER_CLOUD = [5, 9];

const GLOBE_RADIUS_M = 6371008.8;

/* --- geometry ------------------------------------------------------------- */

/**
 * A unit sphere from a subdivided octahedron. Cheap, no seams, and the vertex
 * position doubles as the normal, which the lighting needs anyway.
 */
function buildSphere(subdivisions = 2) {
  let positions = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0],
    [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  let faces = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
  ];

  for (let s = 0; s < subdivisions; s++) {
    const midpoints = new Map();
    const next = [];
    const midpoint = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (midpoints.has(key)) return midpoints.get(key);
      const p = [
        positions[a][0] + positions[b][0],
        positions[a][1] + positions[b][1],
        positions[a][2] + positions[b][2],
      ];
      const len = Math.hypot(...p) || 1;
      positions.push([p[0] / len, p[1] / len, p[2] / len]);
      const index = positions.length - 1;
      midpoints.set(key, index);
      return index;
    };
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    faces = next;
  }

  return {
    positions: new Float32Array(positions.flat()),
    indices: new Uint16Array(faces.flat()),
    triangles: faces.length,
  };
}

/* --- shaders -------------------------------------------------------------- */

/**
 * `prelude` and `define` come from MapLibre's `shaderData` and carry the
 * projection functions and uniforms. Everything below is written against the
 * globe path; the alpha is multiplied by `u_projection_transition` so the
 * clouds are gone by the time the map has flattened into mercator, which is
 * also the point at which cloud cover stops meaning anything.
 */
const vertexSource = (define, prelude) => `${define}
${prelude}

attribute vec3 a_mesh;       // unit sphere vertex, doubles as the normal
attribute vec2 a_center;     // cloud centre, in mercator [0,1]
attribute vec3 a_offset;     // puff offset from that centre, metres
attribute vec3 a_shape;      // x: radius (m), y: shade jitter, z: remoteness

uniform float u_scale;

varying vec3 v_normal;
varying float v_shade;
varying float v_remote;
varying vec3 v_viewDir;

void main() {
  // Where this cloud sits on the unit sphere, and the surface frame there.
  vec3 spherePos = projectToSphere(a_center);
  mat3 frame = globeGetRotationMatrix(spherePos);

  // Flatten the puffs a little: cumulus spreads sideways more than upwards.
  vec3 mesh = a_mesh * vec3(1.0, 1.0, 0.62);

  // Offset and radius are metres, converted into sphere-radius units. The
  // frame's third axis is the local up, so a_offset.z lifts a puff.
  vec3 local = (a_offset + mesh * a_shape.x * u_scale) / ${GLOBE_RADIUS_M.toFixed(1)};
  vec3 worldPos = spherePos + frame * local;

  gl_Position = u_projection_matrix * vec4(worldPos, 1.0);
  gl_Position.z = globeComputeClippingZ(worldPos) * gl_Position.w;

  // Normals in world space, so the lighting is stable as the globe turns.
  v_normal = normalize(frame * (mesh * vec3(1.0, 1.0, 1.0 / 0.62)));
  v_viewDir = normalize(worldPos);
  v_shade = a_shape.y;
  v_remote = a_shape.z;
}
`;

const fragmentSource = `
precision mediump float;

uniform vec3 u_sun;
uniform float u_opacity;

varying vec3 v_normal;
varying float v_shade;
varying float v_remote;
varying vec3 v_viewDir;

void main() {
  vec3 n = normalize(v_normal);

  // Clouds scatter light forward, so some wrap past the terminator is right —
  // but the previous 0.65 wrap was so wide that nothing was ever in shadow,
  // which is what made these look like wax balls. A narrower wrap keeps a
  // readable lit side and shaded side.
  float lambert = dot(n, normalize(u_sun));
  float wrapped = clamp((lambert + 0.28) / 1.28, 0.0, 1.0);

  // Sky bounce from below keeps the undersides blue-grey rather than black.
  float sky = clamp(0.5 + 0.5 * n.z, 0.0, 1.0);

  vec3 shadowTone = vec3(0.42, 0.47, 0.58);
  vec3 litTone = vec3(1.0, 0.995, 0.975);
  vec3 lit = mix(shadowTone, litTone, pow(wrapped, 0.9));
  lit = mix(lit * vec3(0.9, 0.94, 1.05), lit, sky);
  lit *= 0.92 + v_shade * 0.13;

  // The silhouette has to dissolve, or the union of spheres stays countable.
  // Facing away from the viewer means less cloud between the eye and the edge,
  // so alpha falls off hard there and the outline goes soft.
  float facing = abs(dot(n, normalize(v_viewDir)));
  float edge = pow(facing, 1.9);

  // A cheap per-fragment break-up so the rim is not a clean arc. Hashing the
  // normal is enough at this scale and costs nothing.
  float grain = fract(sin(dot(n.xy * 91.7 + n.z * 37.3, vec2(12.9898, 78.233))) * 43758.5453);

  // Thickness grows with distance from the routes. Near the boundary the
  // cover is thin and the land reads straight through; deep in the unknown it
  // is nearly solid and only glimpses get past. This is the cloud *material*
  // getting denser, not the transition fading — the transition is still
  // entirely a matter of whether an instance exists at all.
  float thickness = mix(0.34, 1.0, v_remote);

  float alpha = u_opacity * thickness * clamp(edge - grain * 0.22, 0.0, 1.0);

  if (alpha < 0.01) discard;
  gl_FragColor = vec4(lit * alpha, alpha);
}
`;

/* --- instance data -------------------------------------------------------- */

/**
 * Web Mercator's latitude limit. Beyond this the projection diverges: at 89.9
 * the y coordinate leaves [0, 1] entirely, and `projectToSphere` in the
 * prelude only special-cases the poles when given a `rawPos`, which the vec2
 * overload does not. Unclamped input produced tile coordinates from -151 to
 * 9940 where the valid range is 0 to 8192, i.e. puffs projected to nonsense.
 *
 * Clamping at 85 leaves a small cap uncovered, but a puff sitting at 85 with a
 * radius of ~100 km reaches over it.
 */
const MAX_MERCATOR_LAT = 85;

/**
 * Mercator [0, 1] from lon/lat — and it must be [0, 1], not tile units.
 *
 * The prelude computes
 *   mercator_pos = u_projection_tile_mercator_coords.xy
 *                + u_projection_tile_mercator_coords.zw * posInTile
 * and for a real tile `.zw` is `1 / (2^z * EXTENT)`, so a tiled layer passes
 * positions in [0, 8192]. But `defaultProjectionData` — what a custom layer
 * gets, since it has no tile — returns `[0, 0, 1, 1]`, so `.zw` is 1 and
 * `posInTile` *is* the mercator coordinate.
 *
 * Passing [0, 8192] here made `spherical.y` collapse to -PI/2: every cloud
 * ended up at the south pole, which is why none were visible. The check that
 * missed it asserted the coordinates were within [0, 8192] — the right test
 * for a tiled layer and the wrong invariant for this one.
 */
function lonLatToMercator(lon, lat) {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const x = (180 + wrapped) / 360;
  const sin = Math.sin((clamped * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return [x, y];
}

function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/**
 * Cloud archetypes.
 *
 * A single recipe applied everywhere is what made the first version read as
 * one motif stamped across the planet. Real cloud fields span orders of
 * magnitude, so a cloud picks a type and the types differ in proportion, not
 * just in size.
 */
const ARCHETYPES = [
  // weight, name, footprint scale, height scale, elongation, core lobes, detail lobes
  { weight: 0.42, radius: [40, 85], height: 0.9, stretch: 1.0, cores: 3, detail: 14 },   // fair-weather cumulus
  { weight: 0.24, radius: [70, 150], height: 1.25, stretch: 1.15, cores: 5, detail: 26 }, // congestus, piled up
  { weight: 0.20, radius: [90, 190], height: 0.34, stretch: 2.6, cores: 4, detail: 20 },  // stratus sheet, wide and flat
  { weight: 0.14, radius: [55, 110], height: 0.42, stretch: 4.2, cores: 5, detail: 18 },  // a streak, drawn out by wind
];

function pickArchetype(u) {
  let acc = 0;
  for (const a of ARCHETYPES) {
    acc += a.weight;
    if (u <= acc) return a;
  }
  return ARCHETYPES[0];
}

/**
 * Expand each cloud position into a cluster of puffs.
 *
 * Hierarchical on purpose: a few large core lobes carry the mass, and many
 * smaller detail lobes sit on and between them. That is what stops the
 * silhouette reading as a union of circles — with only five to nine equal
 * spheres per cloud you could count them, which is exactly how the previous
 * version looked.
 *
 * The cluster is also what carries the volume: puffs at different heights and
 * offsets slide across each other as the globe turns.
 */
export function buildCloudInstances(features, { seed = 7717 } = {}) {
  const rand = rng(seed);
  const centers = [];
  const offsets = [];
  const shapes = [];

  const lerp = (range, t) => range[0] + (range[1] - range[0]) * t;

  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates;
    const [mx, my] = lonLatToMercator(lon, lat);
    const scale = f.properties.scale ?? 1;

    const type = pickArchetype(rand());
    const remoteness = f.properties.remoteness ?? 1;

    // Remote clouds are seen from far away and there are many more of them, so
    // they get fewer, larger lobes. Spending the puff budget on detail out
    // there is invisible; spending it on count is what makes the far world
    // actually covered.
    const detailCount = Math.round(type.detail * (1 - remoteness * 0.62));
    const baseRadius = Math.min(
      PUFF_RADIUS_KM[1] * 1000,
      lerp(type.radius, rand()) * 1000 * scale
    );
    const altitude = lerp(CLOUD_ALTITUDE_KM, rand()) * 1000 * type.height;

    // A random heading, so streaks and sheets are not all axis-aligned.
    const heading = rand() * Math.PI * 2;
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);
    const orient = (x, y) => [x * cosH - y * sinH, x * sinH + y * cosH];

    // Core lobes first: the mass of the cloud.
    const cores = [];
    for (let i = 0; i < type.cores; i++) {
      const t = type.cores === 1 ? 0.5 : i / (type.cores - 1);
      const along = (t - 0.5) * baseRadius * type.stretch * 1.6;
      const across = (rand() - 0.5) * baseRadius * 0.7;
      const [ox, oy] = orient(along, across);
      // Piled towards the middle, flattened for the sheet types.
      //
      // Scaled by ALTITUDE, not by radius. At this stylised scale the
      // horizontal radius is several times the altitude, so tying vertical
      // structure to it sent puffs to 218 km — the same mistake as an earlier
      // version, made again.
      const rise = Math.sin(t * Math.PI) * altitude * 0.3 * type.height;
      cores.push({
        x: ox,
        y: oy,
        z: altitude + rise,
        r: baseRadius * (0.62 + 0.38 * Math.sin(t * Math.PI)),
      });
    }

    // Clouds stay inside a believable band around their own altitude.
    const zMin = altitude * 0.55;
    const zMax = altitude * 1.75;
    const emit = (x, y, z, r) => {
      centers.push(mx, my);
      offsets.push(x, y, Math.max(zMin, Math.min(zMax, z)));
      shapes.push(r, rand(), remoteness);
    };

    for (const c of cores) emit(c.x, c.y, c.z, c.r);

    // Detail lobes: smaller, hung off the cores, biased upwards so the tops
    // are lumpy and the bases stay flat, the way cumulus actually sits.
    for (let i = 0; i < detailCount; i++) {
      const c = cores[Math.floor(rand() * cores.length)];
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * c.r * 1.15;
      // 35-70% of their core, not 20-52%. Smaller than that and the lobes
      // are sub-pixel at globe view, and they read as sprinkles on a ball
      // rather than as part of one lumpy mass.
      const r = c.r * (0.35 + rand() * 0.35);
      emit(
        c.x + Math.cos(a) * d,
        c.y + Math.sin(a) * d * (0.55 + 0.45 / type.stretch),
        c.z + (rand() * 0.5 - 0.15) * altitude * 0.35 * type.height,
        r
      );
    }
  }

  return {
    centers: new Float32Array(centers),
    offsets: new Float32Array(offsets),
    shapes: new Float32Array(shapes),
    count: shapes.length / 3,
  };
}

/* --- the layer ------------------------------------------------------------ */

/**
 * A MapLibre custom layer. `renderingMode: '3d'` puts it in the depth-tested
 * pass, which is what lets clouds occlude one another.
 */
export function createCloudLayer({
  id = "clouds-3d",
  instances,
  sun = [0.55, 0.42, 0.72],
  // Below 1 on purpose: the point is a map that is hidden but still there, so
  // the land has to read faintly underneath. Density comes from puffs
  // overlapping, not from any single one being solid.
  opacity = 0.6,
} = {}) {
  // Subdivision 1 (32 triangles) rather than 2 (128): the detail lobes are
  // small on screen and there are far more of them now, so the budget is
  // better spent on count than on tessellation.
  const sphere = buildSphere(1);

  return {
    id,
    type: "custom",
    renderingMode: "3d",

    onAdd(map, gl) {
      this.map = map;
      this.instances = instances;
      this.opacity = opacity;

      // Rendering cannot be observed in the development harness, so the layer
      // reports its own state. `window.__clouds` in a real browser says
      // exactly how far the pipeline got.
      this.diagnostics = {
        added: true,
        instanceCount: instances.count,
        webgl: null,
        instancingAvailable: null,
        programCompiled: false,
        shaderError: null,
        variant: null,
        frames: 0,
        lastTransition: null,
      };
      if (typeof window !== "undefined") window.__clouds = this.diagnostics;

      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          // Surfaced rather than swallowed: a silent shader failure here just
          // means no clouds, with nothing in the console to explain why.
          throw new Error(
            `[clouds-3d] ${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} ` +
              `shader failed: ${gl.getShaderInfoLog(shader)}`
          );
        }
        return shader;
      };

      // The prelude is only available once render() has been called with
      // shaderData, so the program is built lazily on the first frame.
      this.compileProgram = (shaderData) => {
        const program = gl.createProgram();
        gl.attachShader(
          program,
          compile(gl.VERTEX_SHADER, vertexSource(shaderData.define, shaderData.vertexShaderPrelude))
        );
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          throw new Error(`[clouds-3d] link failed: ${gl.getProgramInfoLog(program)}`);
        }

        this.program = program;
        this.variant = shaderData.variantName;
        this.attrs = {
          mesh: gl.getAttribLocation(program, "a_mesh"),
          center: gl.getAttribLocation(program, "a_center"),
          offset: gl.getAttribLocation(program, "a_offset"),
          shape: gl.getAttribLocation(program, "a_shape"),
        };
        this.uniforms = {
          matrix: gl.getUniformLocation(program, "u_projection_matrix"),
          tileMercator: gl.getUniformLocation(program, "u_projection_tile_mercator_coords"),
          clipping: gl.getUniformLocation(program, "u_projection_clipping_plane"),
          // u_projection_transition and u_projection_fallback_matrix are
          // declared by the prelude but never read here — the globe/mercator
          // fade is applied to u_opacity on the CPU instead — so the compiler
          // strips them and getUniformLocation would return null.
          sun: gl.getUniformLocation(program, "u_sun"),
          opacity: gl.getUniformLocation(program, "u_opacity"),
          scale: gl.getUniformLocation(program, "u_scale"),
        };
      };

      const buffer = (data, target = gl.ARRAY_BUFFER) => {
        const b = gl.createBuffer();
        gl.bindBuffer(target, b);
        gl.bufferData(target, data, gl.STATIC_DRAW);
        return b;
      };

      this.buffers = {
        mesh: buffer(sphere.positions),
        index: buffer(sphere.indices, gl.ELEMENT_ARRAY_BUFFER),
        center: buffer(instances.centers),
        offset: buffer(instances.offsets),
        shape: buffer(instances.shapes),
      };
      this.indexCount = sphere.indices.length;
      this.instanceCount = instances.count;
      this.ext = gl.getExtension("ANGLE_instanced_arrays");
    },

    onRemove(map, gl) {
      if (this.program) gl.deleteProgram(this.program);
      for (const b of Object.values(this.buffers || {})) gl.deleteBuffer(b);
    },

    /** Swap the instance data when the trips change. */
    setInstances(next) {
      const gl = this.map?.painter?.context?.gl;
      if (!gl || !this.buffers) return;
      this.instances = next;
      this.instanceCount = next.count;
      for (const [key, data] of [
        ["center", next.centers],
        ["offset", next.offsets],
        ["shape", next.shapes],
      ]) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[key]);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      }
      this.map.triggerRepaint();
    },

    render(gl, options) {
      const data = options.defaultProjectionData;
      const shaderData = options.shaderData;
      if (!data || !shaderData) return;

      // Rebuild if MapLibre switched projection variant mid-session.
      if (!this.program || this.variant !== shaderData.variantName) {
        try {
          this.compileProgram(shaderData);
        } catch (err) {
          console.error(err.message);
          this.diagnostics.shaderError = err.message;
          this.broken = true;
        }
        this.diagnostics.programCompiled = !!this.program;
        this.diagnostics.variant = shaderData.variantName;
      }
      if (this.broken || !this.instanceCount) return;

      // Instancing is a WebGL 1 extension; WebGL 2 has it natively.
      const isWebGL2 = typeof WebGL2RenderingContext !== "undefined" &&
        gl instanceof WebGL2RenderingContext;
      this.diagnostics.webgl = isWebGL2 ? 2 : 1;
      this.diagnostics.lastTransition = data.projectionTransition;
      const divisor = isWebGL2
        ? gl.vertexAttribDivisor.bind(gl)
        : this.ext?.vertexAttribDivisorANGLE?.bind(this.ext);
      const drawInstanced = isWebGL2
        ? gl.drawElementsInstanced.bind(gl)
        : this.ext?.drawElementsInstancedANGLE?.bind(this.ext);
      this.diagnostics.instancingAvailable = !!(divisor && drawInstanced);
      if (!divisor || !drawInstanced) return; // no instancing available

      gl.useProgram(this.program);

      gl.uniformMatrix4fv(this.uniforms.matrix, false, data.mainMatrix);
      gl.uniform4f(this.uniforms.tileMercator, ...data.tileMercatorCoords);
      gl.uniform4f(this.uniforms.clipping, ...data.clippingPlane);
      gl.uniform3f(this.uniforms.sun, ...sun);
      // Gone by the time the globe has flattened into mercator.
      gl.uniform1f(this.uniforms.opacity, this.opacity * data.projectionTransition);
      gl.uniform1f(this.uniforms.scale, 1);

      const bind = (name, buffer, size, instanced) => {
        const loc = this.attrs[name];
        if (loc < 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        divisor(loc, instanced ? 1 : 0);
      };
      bind("mesh", this.buffers.mesh, 3, false);
      bind("center", this.buffers.center, 2, true);
      bind("offset", this.buffers.offset, 3, true);
      bind("shape", this.buffers.shape, 3, true);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);

      // Premultiplied alpha, and crucially NO depth writes.
      //
      // Writing depth etched every puff's silhouette into the buffer, so
      // overlapping puffs showed their intersection curves as hard creases.
      // That is what made a cloud look like a heap of countable balls. With
      // depth writes off, the puffs simply accumulate and merge into one soft
      // mass, and the terrain stays visible through the thinner parts.
      //
      // The far side of the globe is handled by the clipping plane in the
      // vertex shader, not by the depth buffer, so nothing shows through the
      // planet.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      // No face culling. The puffs are closed blobs so back faces are hidden
      // by the depth test anyway, and culling depends on MapLibre's frontFace
      // state being what we assume — if it is not, the layer renders nothing
      // with no error to explain it.
      gl.disable(gl.CULL_FACE);

      drawInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0, this.instanceCount);

      // Leave the divisors as MapLibre expects to find them.
      for (const name of ["center", "offset", "shape"]) {
        const loc = this.attrs[name];
        if (loc >= 0) divisor(loc, 0);
      }

      this.diagnostics.frames++;
    },
  };
}
