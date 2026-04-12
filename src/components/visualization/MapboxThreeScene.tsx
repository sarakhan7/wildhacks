"use client";

import mapboxgl from "mapbox-gl";
import { useCallback, useEffect, useMemo, useRef } from "react";
import Map, { Layer, Marker, type MapRef } from "react-map-gl/mapbox";
import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";

import "mapbox-gl/dist/mapbox-gl.css";

import type {
  SolarVisualization,
  VisualizationGrid,
  VisualizationOverlayMode,
  VisualizationSceneResponse,
  VisualizationScenario,
} from "@/lib/visualization";
import { applyScenarioToThermal } from "@/lib/visualization";

(THREE.BufferGeometry.prototype as THREE.BufferGeometry & {
  computeBoundsTree: typeof computeBoundsTree;
  disposeBoundsTree: typeof disposeBoundsTree;
}).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as THREE.BufferGeometry & {
  computeBoundsTree: typeof computeBoundsTree;
  disposeBoundsTree: typeof disposeBoundsTree;
}).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as THREE.Mesh & { raycast: typeof acceleratedRaycast }).raycast = acceleratedRaycast;

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

type HoverPayload = {
  title: string;
  detail: string;
} | null;

type Props = {
  data: VisualizationSceneResponse;
  scenario: VisualizationScenario;
  overlay: VisualizationOverlayMode;
  month: number;
  particlesEnabled: boolean;
  onHoverChange: (payload: HoverPayload) => void;
};

type LocalPoint = { x: number; z: number };

type LayerState = {
  map: mapboxgl.Map | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  raycaster: THREE.Raycaster | null;
  roofMesh: THREE.Mesh | null;
  wallMeshes: THREE.Mesh[];
  particleSystem: THREE.Object3D | null;
  hoverables: THREE.Object3D[];
  anchor: mapboxgl.MercatorCoordinate | null;
  meterScale: number;
  roofSolarTexture: THREE.DataTexture | null;
  roofMaskTexture: THREE.DataTexture | null;
  roofThermalTexture: THREE.DataTexture | null;
  wallThermalTextures: Partial<Record<string, THREE.DataTexture>>;
  roofUniforms: Record<string, THREE.IUniform<unknown>> | null;
  wallUniforms: Array<Record<string, THREE.IUniform<unknown>>>;
  particleUniforms: Record<string, THREE.IUniform<unknown>> | null;
  footprints: LocalPoint[][];
  footprintLimits: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  hoveredKey: string;
};

function createEmptyLayerState(): LayerState {
  return {
    map: null,
    scene: null,
    camera: null,
    renderer: null,
    raycaster: null,
    roofMesh: null,
    wallMeshes: [],
    particleSystem: null,
    hoverables: [],
    anchor: null,
    meterScale: 1,
    roofSolarTexture: null,
    roofMaskTexture: null,
    roofThermalTexture: null,
    wallThermalTextures: {},
    roofUniforms: null,
    wallUniforms: [],
    particleUniforms: null,
    footprints: [],
    footprintLimits: null,
    hoveredKey: "",
  };
}

function getRectangleFootprint(squareFeet: number, floors: number): LocalPoint[] {
  const areaMeters2 = Math.max(60, (squareFeet / Math.max(1, floors || 1)) * 0.092903);
  const aspect = 1.45;
  const length = Math.sqrt(areaMeters2 * aspect);
  const width = areaMeters2 / length;
  const halfLength = length / 2;
  const halfWidth = width / 2;
  return [
    { x: -halfLength, z: -halfWidth },
    { x: halfLength, z: -halfWidth },
    { x: halfLength, z: halfWidth },
    { x: -halfLength, z: halfWidth },
  ];
}

function ringArea(points: LocalPoint[]) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current.x * next.z - next.x * current.z;
  }
  return area / 2;
}

function sanitizeFootprint(points: LocalPoint[]) {
  const deduped = points.filter((point, index, list) => {
    const prev = list[index - 1];
    return !prev || Math.hypot(point.x - prev.x, point.z - prev.z) > 0.1;
  });

  if (deduped.length < 3) {
    return [];
  }

  const minX = Math.min(...deduped.map((point) => point.x));
  const maxX = Math.max(...deduped.map((point) => point.x));
  const minZ = Math.min(...deduped.map((point) => point.z));
  const maxZ = Math.max(...deduped.map((point) => point.z));
  if (!Number.isFinite(minX + maxX + minZ + maxZ) || maxX - minX > 350 || maxZ - minZ > 350) {
    return [];
  }

  return ringArea(deduped) < 0 ? [...deduped].reverse() : deduped;
}

function featureCoordinatesToLocal(
  coordinates: [number, number][],
  centerLng: number,
  centerLat: number,
) {
  const center = mapboxgl.MercatorCoordinate.fromLngLat([centerLng, centerLat], 0);
  const scale = center.meterInMercatorCoordinateUnits();
  return coordinates.map(([lng, lat]) => {
    const merc = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], 0);
    return {
      x: (merc.x - center.x) / scale,
      z: -(merc.y - center.y) / scale,
    };
  });
}

function extractFeatureRing(feature: mapboxgl.MapboxGeoJSONFeature): [number, number][] | null {
  if (!feature.geometry) {
    return null;
  }
  if (feature.geometry.type === "Polygon") {
    return feature.geometry.coordinates[0] as [number, number][];
  }
  if (feature.geometry.type === "MultiPolygon") {
    return feature.geometry.coordinates[0]?.[0] as [number, number][] | undefined || null;
  }
  return null;
}

function centroidOfRing(ring: [number, number][]) {
  let lng = 0;
  let lat = 0;
  ring.forEach(([x, y]) => {
    lng += x;
    lat += y;
  });
  return { lng: lng / ring.length, lat: lat / ring.length };
}

function distanceToCenter(ring: [number, number][], lng: number, lat: number) {
  const centroid = centroidOfRing(ring);
  return Math.hypot(centroid.lng - lng, centroid.lat - lat);
}




function pointInGeoRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonsTouch(p1: [number, number][], p2: [number, number][]) {
  const tol = 0.000015;
  for (const v1 of p1) {
    for (const v2 of p2) {
      if (Math.abs(v1[0] - v2[0]) < tol && Math.abs(v1[1] - v2[1]) < tol) {
        return true;
      }
    }
  }
  return false;
}

function resolveFootprints(map: mapboxgl.Map, data: VisualizationSceneResponse): { footprints: LocalPoint[][], bounds: { minX: number, maxX: number, minZ: number, maxZ: number } } | null {
  try {
    const point = map.project([data.building.lng, data.building.lat]);
    const rendered = map.queryRenderedFeatures(
      [[point.x - 120, point.y - 120], [point.x + 120, point.y + 120]],
      { layers: ["visualization-context-buildings"] },
    );

    const allRings: [number, number][][] = [];
    rendered.forEach(f => {
      if (f.geometry && f.geometry.type === "Polygon") {
        allRings.push(f.geometry.coordinates[0] as [number, number][]);
      } else if (f.geometry && f.geometry.type === "MultiPolygon") {
        f.geometry.coordinates.forEach(poly => allRings.push(poly[0] as [number, number][]));
      }
    });

    const validRings = allRings.filter(r => r && r.length >= 3);
    if (validRings.length === 0) return null;

    let seedIndex = -1;
    let minD = Infinity;
    for (let i = 0; i < validRings.length; i++) {
        if (pointInGeoRing(data.building.lng, data.building.lat, validRings[i])) {
            seedIndex = i;
            break;
        }
        const d = distanceToCenter(validRings[i], data.building.lng, data.building.lat);
        if (d < minD) { minD = d; seedIndex = i; }
    }

    if (seedIndex === -1) return null;

    const grouped = new Set<number>([seedIndex]);
    const queue = [seedIndex];
    let head = 0;
    while (head < queue.length) {
      const curr = validRings[queue[head++]];
      for (let i = 0; i < validRings.length; i++) {
        if (!grouped.has(i) && polygonsTouch(curr, validRings[i])) {
          grouped.add(i);
          queue.push(i);
        }
      }
    }

    const footprints: LocalPoint[][] = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    
    Array.from(grouped).forEach(i => {
      const fp = sanitizeFootprint(featureCoordinatesToLocal(validRings[i], data.building.lng, data.building.lat));
      if (fp.length >= 3) {
        footprints.push(fp);
        fp.forEach(p => {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.z < minZ) minZ = p.z;
          if (p.z > maxZ) maxZ = p.z;
        });
      }
    });

    if (footprints.length === 0) return null;
    return { footprints, bounds: { minX, maxX, minZ, maxZ } };
  } catch {
    return null;
  }
}

function normalizeGridValues(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value));
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = Math.max(max - min, 0.0001);
  return values.map((value) => Number(((value - min) / span).toFixed(6)));
}

function createTexture(grid: VisualizationGrid, normalized = true) {
  const sourceValues = normalized ? normalizeGridValues(grid.values) : grid.values;
  const texture = new THREE.DataTexture(
    Float32Array.from(sourceValues),
    grid.width,
    grid.height,
    THREE.RedFormat,
    THREE.FloatType,
  );
  texture.needsUpdate = true;
  texture.flipY = true;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function createRoofShaderMaterial(
  solarTexture: THREE.DataTexture,
  thermalTexture: THREE.DataTexture,
  maskTexture: THREE.DataTexture,
) {
  const uniforms = {
    uSolar: { value: solarTexture },
    uThermal: { value: thermalTexture },
    uMask: { value: maskTexture },
    uOverlayMode: { value: 2 },
    uOpacity: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vNormal = normalMatrix * normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uSolar;
      uniform sampler2D uThermal;
      uniform sampler2D uMask;
      uniform float uOverlayMode;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormal;

      vec3 solarRamp(float t) {
        float s = clamp(t, 0.0, 1.0);
        vec3 low  = vec3(0.2, 0.4, 0.9);   // bright blue
        vec3 mid  = vec3(1.0, 0.85, 0.2);  // yellow
        vec3 high = vec3(0.95, 0.2, 0.1);  // red
        return s < 0.5 ? mix(low, mid, s * 2.0) : mix(mid, high, (s - 0.5) * 2.0);
      }

      vec3 thermalRamp(float t) {
        float s = clamp(t, 0.0, 1.0);
        vec3 cold  = vec3(0.2, 0.4, 0.9);
        vec3 hot   = vec3(0.95, 0.2, 0.1);
        return mix(cold, hot, s);
      }

      void main() {
        float mask = texture2D(uMask, vUv).r;
        if (mask < 0.05) discard;
        float solar = texture2D(uSolar, vUv).r;
        float thermal = texture2D(uThermal, vUv).r;
        vec3 solarColor = solarRamp(solar);
        vec3 thermalColor = thermalRamp(thermal);
        vec3 baseColor = uOverlayMode < 0.5 ? solarColor : uOverlayMode < 1.5 ? thermalColor : mix(solarColor, thermalColor, 0.45);
        vec3 lightDir = normalize(vec3(0.4, 0.85, 0.3));
        float shade = 0.55 + max(dot(normalize(vNormal), lightDir), 0.0) * 0.45;
        gl_FragColor = vec4(baseColor * shade, uOpacity * 0.92);
      }
    `,
  });

  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;

  return { material, uniforms };
}

function getExteriorEdges(polygons: LocalPoint[][]) {
  const edges: Record<string, { start: LocalPoint, end: LocalPoint, count: number }> = {};
  polygons.forEach(poly => {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const minZ = Math.min(p1.z, p2.z);
      const maxZ = Math.max(p1.z, p2.z);
      const key = `${minX.toFixed(2)},${minZ.toFixed(2)}-${maxX.toFixed(2)},${maxZ.toFixed(2)}`;
      const existing = edges[key];
      if (existing) {
        existing.count++;
      } else {
        edges[key] = { start: p1, end: p2, count: 1 };
      }
    }
  });
  return Object.values(edges).filter((e: any) => e.count <= 1).map((e: any) => ({ start: e.start, end: e.end }));
}

function createParticleSystem(exteriorEdges: Array<{start: LocalPoint, end: LocalPoint}>, height: number) {
  const basePositions: number[] = [];
  const directions: number[] = [];
  const offsets: number[] = [];
  const intensities: number[] = [];

  exteriorEdges.forEach(edge => {
     const dx = edge.end.x - edge.start.x;
     const dz = edge.end.z - edge.start.z;
     const len = Math.hypot(dx, dz);
     if (len < 0.1) return;
     
     const nx = dz / len;
     const nz = -dx / len;
     
     const numParticles = Math.floor(len * height * 0.4);
     for (let i = 0; i < numParticles; i++) {
        const t = Math.random();
        const x = edge.start.x + dx * t;
        const z = edge.start.z + dz * t;
        const y = Math.random() * height;
        const offset = Math.random();
        const intensity = 0.3 + Math.random() * 0.7;
        
        basePositions.push(x, y, z);
        directions.push(nx * 0.3, 1.0, nz * 0.3);
        offsets.push(offset);
        intensities.push(intensity);
     }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("basePosition", new THREE.Float32BufferAttribute(basePositions, 3));
  geometry.setAttribute("direction", new THREE.Float32BufferAttribute(directions, 3));
  geometry.setAttribute("offset", new THREE.Float32BufferAttribute(offsets, 1));
  geometry.setAttribute("intensity", new THREE.Float32BufferAttribute(intensities, 1));

  const uniforms = {
    uTime: { value: 0 },
    uVisible: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms,
    vertexShader: `
      attribute vec3 basePosition;
      attribute vec3 direction;
      attribute float offset;
      attribute float intensity;
      uniform float uTime;
      uniform float uVisible;
      varying float vIntensity;
      varying float vAnimation;
      void main() {
        float speed = 0.05 + intensity * 0.04;
        float cycle = fract(uTime * speed + offset);
        float travelY = cycle * 12.0;
        
        vec3 pos = basePosition + direction * travelY;
        pos.x += sin(cycle * 6.28 + basePosition.y) * 0.5 * cycle;
        pos.z += cos(cycle * 6.28 + basePosition.x) * 0.5 * cycle;
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = (12.0 + intensity * 30.0) * uVisible;
        
        vAnimation = smoothstep(0.0, 0.2, cycle) * smoothstep(1.0, 0.6, cycle);
        vIntensity = intensity;
      }
    `,
    fragmentShader: `
      uniform float uVisible;
      varying float vIntensity;
      varying float vAnimation;
      void main() {
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        float radial = smoothstep(0.5, 0.1, dist);
        
        vec3 color = mix(vec3(0.0, 0.2, 0.8), vec3(0.9, 0.2, 0.1), vIntensity);
        gl_FragColor = vec4(color, radial * vAnimation * 0.65 * uVisible);
      }
    `,
  });

  return {
    points: new THREE.Points(geometry, material),
    uniforms,
  };
}

function buildRoofGeometry(footprints: LocalPoint[][], height: number, radius: number) {
  const shapes: THREE.Shape[] = [];
  footprints.forEach(fp => {
    const shape = new THREE.Shape();
    fp.forEach((point, index) => {
      if (index === 0) shape.moveTo(point.x, point.z);
      else shape.lineTo(point.x, point.z);
    });
    shape.closePath();
    shapes.push(shape);
  });

  const geometry = new THREE.ShapeGeometry(shapes);
  const pos = geometry.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getY(i); 
    uvs[i * 2] = (x + radius) / (2 * radius);
    uvs[i * 2 + 1] = (z + radius) / (2 * radius);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, height + 0.5, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundsTree();
  return geometry;
}

function getMonthlyGrid(solar: SolarVisualization, month: number) {
  if (month > 0) {
    return solar.monthlyFluxGrids.find((grid) => grid.month === month) ?? solar.annualFluxGrid;
  }
  return solar.annualFluxGrid;
}

function createThermalGridTexture(surface: ReturnType<typeof applyScenarioToThermal>[number]) {
  return createTexture(
    {
      width: surface.patchGrid.cols,
      height: surface.patchGrid.rows,
      values: surface.patchValues,
    },
    true,
  );
}

function createHoverDetail(
  data: VisualizationSceneResponse,
  thermalSurfaces: ReturnType<typeof applyScenarioToThermal>,
  object: THREE.Object3D,
  uv: THREE.Vector2,
): HoverPayload {
  const kind = object.userData.kind as string | undefined;
  if (!kind) {
    return null;
  }

  if (kind === "roof") {
    const solarGrid = data.solar.annualFluxGrid;
    const maskGrid = data.solar.roofMaskGrid;
    const col = Math.min(solarGrid.width - 1, Math.max(0, Math.floor(uv.x * solarGrid.width)));
    const row = Math.min(solarGrid.height - 1, Math.max(0, Math.floor((1 - uv.y) * solarGrid.height)));
    const index = row * solarGrid.width + col;
    const flux = solarGrid.values[index];
    const mask = maskGrid.values[index];
    return {
      title: "Roof solar patch",
      detail:
        mask > 0.08
          ? `Annual flux ${flux.toFixed(1)} kWh/kW/yr equivalent, relative suitability ${(flux / Math.max(...solarGrid.values)).toFixed(2)}.`
          : "This roof texel is masked outside the usable Google Solar roof area.",
    };
  }

  const surface = thermalSurfaces.find((entry) => entry.kind === kind);
  if (!surface) {
    return null;
  }
  const col = Math.min(surface.patchGrid.cols - 1, Math.max(0, Math.floor(uv.x * surface.patchGrid.cols)));
  const row = Math.min(surface.patchGrid.rows - 1, Math.max(0, Math.floor((1 - uv.y) * surface.patchGrid.rows)));
  const index = row * surface.patchGrid.cols + col;
  const flux = surface.patchValues[index];
  return {
    title: kind.replaceAll("_", " "),
    detail: `Modeled envelope loss ${flux.toFixed(1)} W/m² in this patch. Scenario-adjusted base flux ${surface.baseFluxWm2.toFixed(1)} W/m².`,
  };
}

export default function MapboxThreeScene({
  data,
  scenario,
  overlay,
  month,
  particlesEnabled,
  onHoverChange,
}: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const layerStateRef = useRef<LayerState>(createEmptyLayerState());
  const customLayerAddedRef = useRef(false);
  const mouseRef = useRef(new THREE.Vector2(0, 0));
  const hoverDirtyRef = useRef(false);

  const thermalSurfaces = useMemo(
    () => applyScenarioToThermal(data.thermal, scenario, month || 7),
    [data, scenario, month],
  );

  const rebuildScene = useCallback(() => {
    const layerState = layerStateRef.current;
    if (!layerState.scene || !layerState.map) {
      return;
    }

    [...layerState.scene.children]
      .filter((child) => child.userData.visualization)
      .forEach((child) => {
        layerState.scene?.remove(child);
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Points) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((material) => material.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    Object.values(layerState.wallThermalTextures).forEach((texture) => texture?.dispose());
    layerState.roofSolarTexture?.dispose();
    layerState.roofMaskTexture?.dispose();
    layerState.roofThermalTexture?.dispose();

    const footprintResult = resolveFootprints(layerState.map, data);
    if (!footprintResult) {
      const retryOnIdle = () => {
        layerState.map?.off("idle", retryOnIdle);
        rebuildScene();
      };
      layerState.map.on("idle", retryOnIdle);
      const tempFootprint = getRectangleFootprint(data.building.squareFeet, data.building.floors);
      layerState.footprints = [tempFootprint];
      layerState.footprintLimits = {
         minX: Math.min(...tempFootprint.map(p => p.x)),
         maxX: Math.max(...tempFootprint.map(p => p.x)),
         minZ: Math.min(...tempFootprint.map(p => p.z)),
         maxZ: Math.max(...tempFootprint.map(p => p.z))
      };
      return;
    }
    const { footprints, bounds } = footprintResult;
    const height = data.building.inferredHeightMeters;
    layerState.footprints = footprints;
    layerState.footprintLimits = bounds;

    const roofSolarTexture = createTexture(getMonthlyGrid(data.solar, month), true);
    const roofMaskTexture = createTexture(data.solar.roofMaskGrid, false);
    const roofThermalTexture = createThermalGridTexture(
      thermalSurfaces.find((surface) => surface.kind === "roof") ?? thermalSurfaces[0],
    );

    layerState.roofSolarTexture = roofSolarTexture;
    layerState.roofMaskTexture = roofMaskTexture;
    layerState.roofThermalTexture = roofThermalTexture;

    // Mapbox handles the 3D building body via fill-extrusion.
    // Three.js only adds overlay layers: roof heatmap, wall thermal, particles.

    // --- Roof overlay (solar + thermal heatmap) ---
    const radius = data.solar.gridRadiusMeters || 100.0;
    const roofGeometry = buildRoofGeometry(footprints, height, radius);
    const { material: roofMaterial, uniforms: roofUniforms } = createRoofShaderMaterial(
      roofSolarTexture,
      roofThermalTexture,
      roofMaskTexture,
    );
    const roofMesh = new THREE.Mesh(roofGeometry, roofMaterial);
    roofMesh.renderOrder = 2;
    roofMesh.userData.kind = "roof";
    roofMesh.userData.visualization = true;
    layerState.roofMesh = roofMesh;
    layerState.roofUniforms = roofUniforms;
    layerState.scene.add(roofMesh);

    // --- Clean edge wireframe for roof only ---
    const edgeGroup = new THREE.Group();
    const edges = new THREE.EdgesGeometry(roofMesh.geometry);
    const lines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x1a7fa8, opacity: 0.35, transparent: true }),
    );
    lines.position.copy(roofMesh.position);
    lines.rotation.copy(roofMesh.rotation);
    lines.userData.visualization = true;
    edgeGroup.add(lines);
    edgeGroup.userData.visualization = true;
    layerState.scene.add(edgeGroup);

    // --- Particle system (wind flow streamlines) ---
    const exteriorEdges = getExteriorEdges(footprints);
    const { points, uniforms: particleUniforms } = createParticleSystem(exteriorEdges, height);
    points.userData.visualization = true;
    points.renderOrder = 3;
    layerState.particleSystem = points;
    layerState.particleUniforms = particleUniforms;
    layerState.scene.add(points);

    layerState.hoverables = [roofMesh];
  }, [data, month, thermalSurfaces]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || customLayerAddedRef.current) {
      return;
    }

    const customLayer: mapboxgl.CustomLayerInterface = {
      id: "audit-thermal-visualization",
      type: "custom",
      renderingMode: "3d",
      onAdd(activeMap, gl) {
        const layerState = layerStateRef.current;
        layerState.map = activeMap;
        layerState.scene = new THREE.Scene();
        layerState.camera = new THREE.PerspectiveCamera();
        layerState.renderer = new THREE.WebGLRenderer({
          canvas: activeMap.getCanvas(),
          context: gl,
          antialias: true,
        });
        layerState.renderer.autoClear = false;
        layerState.renderer.outputColorSpace = THREE.SRGBColorSpace;
        layerState.raycaster = new THREE.Raycaster();
        layerState.anchor = mapboxgl.MercatorCoordinate.fromLngLat([data.building.lng, data.building.lat], 0);
        layerState.meterScale = layerState.anchor.meterInMercatorCoordinateUnits();

        const ambient = new THREE.AmbientLight(0xc8e6ff, 1.1);
        const directional = new THREE.DirectionalLight(0xffffff, 1.25);
        directional.position.set(90, 140, 60);
        layerState.scene.add(ambient, directional);

        // Defer initial build to allow tiles to load;
        // will also rebuild via useEffect / idle
        activeMap.once("idle", () => rebuildScene());
      },
      render(_gl, matrix) {
        const layerState = layerStateRef.current;
        if (!layerState.scene || !layerState.camera || !layerState.renderer || !layerState.anchor) {
          return;
        }

        const mapMatrix = new THREE.Matrix4().fromArray(matrix as number[]);
        const rotationX = new THREE.Matrix4().makeRotationX(Math.PI / 2);
        const transform = new THREE.Matrix4()
          .makeTranslation(layerState.anchor.x, layerState.anchor.y, layerState.anchor.z)
          .scale(new THREE.Vector3(layerState.meterScale, -layerState.meterScale, layerState.meterScale))
          .multiply(rotationX);

        layerState.camera.projectionMatrix = mapMatrix.multiply(transform);
        layerState.camera.projectionMatrixInverse.copy(layerState.camera.projectionMatrix).invert();
        layerState.camera.matrixWorld.identity();
        layerState.camera.matrixWorldInverse.identity();

        if (layerState.particleUniforms) {
          layerState.particleUniforms.uTime.value = performance.now() * 0.0007;
          layerState.particleUniforms.uVisible.value = particlesEnabled ? 1 : 0;
        }

        if (layerState.roofUniforms) {
          layerState.roofUniforms.uOverlayMode.value =
            overlay === "solar" ? 0 : overlay === "thermal" ? 1 : 2;
        }

        layerState.wallUniforms.forEach((uniforms) => {
          uniforms.uVisible.value = overlay === "solar" ? 0.08 : 0.96;
        });

        if (hoverDirtyRef.current && layerState.raycaster) {
          layerState.raycaster.setFromCamera(mouseRef.current, layerState.camera);
          const intersections = layerState.raycaster.intersectObjects(layerState.hoverables, false);
          const hit = intersections[0];
          const nextHover =
            hit && hit.uv ? createHoverDetail(data, thermalSurfaces, hit.object, hit.uv) : null;
          const hoverKey = nextHover ? `${nextHover.title}:${nextHover.detail}` : "";
          if (hoverKey !== layerState.hoveredKey) {
            layerState.hoveredKey = hoverKey;
            onHoverChange(nextHover);
          }
          hoverDirtyRef.current = false;
        }

        layerState.renderer.resetState();
        layerState.renderer.render(layerState.scene, layerState.camera);
        layerState.map?.triggerRepaint();
      },
    };

    map.addLayer(customLayer);
    customLayerAddedRef.current = true;

    return () => {
      if (map.getLayer("audit-thermal-visualization")) {
        map.removeLayer("audit-thermal-visualization");
      }
      customLayerAddedRef.current = false;
      const layerState = layerStateRef.current;
      layerState.renderer?.dispose();
      layerStateRef.current = createEmptyLayerState();
    };
  }, [data, onHoverChange, overlay, particlesEnabled, rebuildScene, thermalSurfaces]);

  useEffect(() => {
    if (!customLayerAddedRef.current) {
      return;
    }
    rebuildScene();
  }, [rebuildScene]);

  return (
    <div className="relative h-[720px]">
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{
          longitude: data.building.lng,
          latitude: data.building.lat,
          zoom: 18,
          pitch: 66,
          bearing: -26,
        }}
        mapStyle="mapbox://styles/mapbox/light-v11"
        onMouseMove={(event) => {
          const map = mapRef.current?.getMap();
          if (!map) {
            return;
          }
          mouseRef.current.set(
            (event.point.x / map.getCanvas().clientWidth) * 2 - 1,
            -((event.point.y / map.getCanvas().clientHeight) * 2 - 1),
          );
          hoverDirtyRef.current = true;
        }}
        onMouseLeave={() => {
          hoverDirtyRef.current = false;
          onHoverChange(null);
        }}
        reuseMaps
      >
        <Marker longitude={data.building.lng} latitude={data.building.lat} color="#00e586" />
        <Layer
          id="visualization-context-buildings"
          source="composite"
          source-layer="building"
          filter={["==", ["get", "extrude"], "true"]}
          type="fill-extrusion"
          paint={{
            "fill-extrusion-color": [
              "interpolate", ["linear"], ["get", "height"],
              0, "#d4dce6",
              15, "#b0c4d8",
              40, "#8aaabe",
              80, "#6690a8",
            ],
            "fill-extrusion-height": ["coalesce", ["to-number", ["get", "height"]], 0],
            "fill-extrusion-base": ["coalesce", ["to-number", ["get", "min_height"]], 0],
            "fill-extrusion-opacity": 0.7,
          }}
        />
      </Map>

      <div className="pointer-events-none absolute inset-0 rounded-[16px] border border-[rgba(255,255,255,0.08)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" />
      <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-[rgba(8,145,178,0.55)] bg-[rgba(8,145,178,0.85)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-md">
        {overlay === "both" ? "Solar + Thermal" : overlay === "solar" ? "Solar Roof Flux" : "Thermal Envelope"}
      </div>
    </div>
  );
}
