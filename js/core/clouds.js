/**
 * Volumetric-looking clouds as discrete instances, not as a texture.
 *
 * The previous approach painted a repeating pattern into a polygon. It failed
 * for exactly the reasons it was always going to: the pattern tiled visibly,
 * MapLibre subdivided it further on zoom so the seams multiplied, and the
 * polygon boundary put a hard straight edge at the radius. A texture cannot be
 * a cloud, because a cloud is an object.
 *
 * So each cloud here is an object. Two things follow from that:
 *
 *   The radius is a spawn rule, not a mask. Nothing is generated inside the
 *   near radius. Between near and far the *probability of a cloud existing*
 *   ramps up, so the boundary is where instances stop appearing — ragged, and
 *   different every few hundred kilometres. Nothing fades in opacity.
 *
 *   Volume is not this module's job. Placement lives here; the geometry and
 *   shading live in core/clouds3d.js, which expands each position into a
 *   cluster of 3D puffs drawn as a MapLibre custom layer.
 */

/* --- geometry ------------------------------------------------------------- */

const R_EARTH_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;

function haversineKm(lon1, lat1, lon2, lat2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(a));
}

/**
 * Distance from a point to the nearest edge of a lon/lat box, in km.
 * Clamping into the box first turns this into a point-to-point distance,
 * which is close enough at these scales and far cheaper than a true
 * point-to-rectangle geodesic.
 */
function distanceToBoxKm(lon, lat, [w, s, e, n]) {
  const clampedLat = Math.max(s, Math.min(n, lat));
  // Longitude wraps; pick whichever side of the box is actually nearer.
  let clampedLon = Math.max(w, Math.min(e, lon));
  const direct = Math.abs(lon - clampedLon);
  if (direct > 180) clampedLon = lon > 0 ? w + 360 : e - 360;
  if (lon >= w && lon <= e && lat >= s && lat <= n) return 0;
  return haversineKm(lon, lat, clampedLon, clampedLat);
}

const distanceToNearestTripKm = (lon, lat, boxes) =>
  boxes.length ? Math.min(...boxes.map((b) => distanceToBoxKm(lon, lat, b))) : Infinity;

/* --- the cloud model ------------------------------------------------------ */

function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/* --- placement ------------------------------------------------------------ */

/**
 * Where clouds are allowed to exist, given the trips.
 *
 * Returns a spawn probability in [0, 1]:
 *   0            inside `nearKm` of any trip — clear sky over what I have ridden
 *   0 → 1        across the band between `nearKm` and `farKm`
 *   1            beyond `farKm` — the world I have not seen
 *
 * The ramp is squared so the clearing hugs the routes and the cover thickens
 * quickly, rather than the boundary sitting exactly halfway.
 */
/**
 * Distance at which a cloud reaches full size and full thickness.
 *
 * Beyond `farKm`, because cover becomes continuous at the far radius but the
 * masses should keep growing past it. Not *far* beyond, though: at 4 500 km
 * the ramp was so slow that the 1 500–3 000 km band only reached 47% sky
 * cover, which left the whole of North Africa legible despite being nowhere
 * near a route.
 */
export const REMOTE_KM = 2600;

export function spawnProbability(distanceKm, nearKm, farKm) {
  if (distanceKm <= nearKm) return 0;
  if (distanceKm >= farKm) return 1;
  const t = (distanceKm - nearKm) / (farKm - nearKm);
  return t * t;
}

/**
 * Scatter cloud instances over the sphere.
 *
 * Sampled in two tiers, because one uniform pass does not work. The
 * transition band is a thin collar around a handful of boxes in Europe — a
 * rounding error next to the area of the whole planet — so uniform candidates
 * almost never land in it. A first attempt produced 2 578 clouds beyond the
 * far radius and 22 inside the band: a wall, not a thinning.
 *
 *   Far tier    equal-area over the whole sphere (`lat = asin(u)`, so they are
 *               not bunched at the poles), giving the solid unknown world.
 *   Near tier   dense sampling of just the collar around the trips, which is
 *               what actually renders the gradient — many small clouds where
 *               cover is starting to break up.
 *
 * Both tiers accept a candidate with the spawn probability for its distance,
 * so the boundary is where instances stop existing: ragged, irregular, and
 * different everywhere along it.
 */
export function generateCloudInstances({
  tripBboxes = [],
  count = 2200,
  nearCount = 1400,
  nearKm = 200,
  farKm = 1100,
  seed = 20260909,
} = {}) {
  const rand = rng(seed);
  const features = [];

  /**
   * How far into the unknown a cloud sits, on two different scales.
   *
   * `maturity` saturates at `farKm` and drives the spawn probability.
   * `remoteness` keeps climbing well past it, out to REMOTE_KM, and drives
   * SIZE — so cover does not just become continuous at the far radius, it
   * becomes a front of large merged masses. Clamping size at `farKm` made
   * every cloud beyond it identical, which is why the far ocean looked like an
   * even scatter rather than deep weather.
   */
  const push = (lon, lat, distance) => {
    const maturity = Math.min(1, Math.max(0, (distance - nearKm) / (farKm - nearKm)));
    const remoteness = Math.min(1, Math.max(0, (distance - nearKm) / (REMOTE_KM - nearKm)));
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [+lon.toFixed(3), +lat.toFixed(3)] },
      properties: {
        maturity: +maturity.toFixed(3),
        remoteness: +remoteness.toFixed(3),
        // Size, not opacity. Small broken puffs where cover is starting;
        // large systems deep in the unknown. The exponent is 1.4 rather than
        // 2: squaring kept the middle of the ramp too small for too long.
        scale: +(0.5 + Math.pow(remoteness, 1.4) * 2.6 + rand() * 0.4).toFixed(3),
        // Larger systems behind, so smaller ones read as nearer.
        sort: Math.round(remoteness * 100),
      },
    });
  };

  /* --- far tier: the unknown world -------------------------------------- */
  // No early break: capping the loop the moment `count` is reached fills the
  // list with far-world candidates before the collar gets a chance.
  for (let i = 0; i < count; i++) {
    const lon = rand() * 360 - 180;
    const lat = (Math.asin(rand() * 2 - 1) * 180) / Math.PI;
    const distance = distanceToNearestTripKm(lon, lat, tripBboxes);
    if (rand() < spawnProbability(distance, nearKm, farKm)) push(lon, lat, distance);
  }

  /* --- near tier: the collar around the trips --------------------------- */
  if (tripBboxes.length && nearCount > 0) {
    // The collar, in degrees, with a margin so the outer edge of the gradient
    // is inside the sampled region rather than clipped by it.
    // Out to REMOTE_KM, not farKm: the band between them is where the cover
    // thickens, and the global tier alone is too sparse to sell it.
    const marginDeg = (REMOTE_KM + 250) / 111;
    const west = Math.min(...tripBboxes.map((b) => b[0]));
    const south = Math.min(...tripBboxes.map((b) => b[1]));
    const east = Math.max(...tripBboxes.map((b) => b[2]));
    const north = Math.max(...tripBboxes.map((b) => b[3]));

    const latLo = Math.max(-89, south - marginDeg);
    const latHi = Math.min(89, north + marginDeg);

    for (let i = 0; i < nearCount; i++) {
      // Area-weighted in latitude so the collar is not denser towards a pole.
      const sinLo = Math.sin(toRad(latLo));
      const sinHi = Math.sin(toRad(latHi));
      const lat = (Math.asin(sinLo + rand() * (sinHi - sinLo)) * 180) / Math.PI;
      // Longitude margin grows as the cosine shrinks, so the collar stays the
      // same width in kilometres at every latitude.
      const lonMargin = marginDeg / Math.max(0.2, Math.cos(toRad(lat)));
      const lonLo = west - lonMargin;
      const lonHi = east + lonMargin;
      const lon = lonLo + rand() * (lonHi - lonLo);

      const distance = distanceToNearestTripKm(lon, lat, tripBboxes);
      // The global tier also covers this ground, and the overlap is wanted:
      // more density between farKm and REMOTE_KM is exactly the point.
      if (distance >= REMOTE_KM) continue;
      if (rand() < spawnProbability(distance, nearKm, farKm)) push(lon, lat, distance);
    }
  }

  return { type: "FeatureCollection", features };
}
