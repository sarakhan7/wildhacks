"use client";

import mapboxgl from "mapbox-gl";
import { useCallback, useEffect, useMemo, useRef } from "react";
import Map, { Layer, Marker, type MapRef } from "react-map-gl/mapbox";
import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";

import "mapbox-gl/dist/mapbox-gl.css";

import type {
  GeoBounds,
  SolarVisualization,
  VisualizationGrid,
  VisualizationOverlayMode,
  VisualizationSurfaceKind,
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
type BuildingPart = { ring: LocalPoint[]; height: number };
type ExteriorEdge = {
  start: LocalPoint;
  end: LocalPoint;
  height: number;
  kind: VisualizationSurfaceKind;
  normal: LocalPoint;
  tangent: LocalPoint;
  length: number;
  hotspots: number[];
  emitterWeight: number;
};

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
  roofObservedTexture: THREE.DataTexture | null;
  roofCoverageTexture: THREE.DataTexture | null;
  roofConfidenceTexture: THREE.DataTexture | null;
  roofThermalTexture: THREE.DataTexture | null;
  wallThermalTextures: Partial<Record<string, THREE.DataTexture>>;
  roofUniforms: Record<string, THREE.IUniform<unknown>> | null;
  wallUniforms: Array<Record<string, THREE.IUniform<unknown>>>;
  particleUniforms: Record<string, THREE.IUniform<unknown>> | null;
  displayRoofGrids: {
    solarGrid: VisualizationGrid;
    observedSolarGrid: VisualizationGrid;
    coverageGrid: VisualizationGrid;
    confidenceGrid: VisualizationGrid;
    renderBounds: GeoBounds;
  } | null;
  parts: BuildingPart[];
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
    roofObservedTexture: null,
    roofCoverageTexture: null,
    roofConfidenceTexture: null,
    roofThermalTexture: null,
    wallThermalTextures: {},
    roofUniforms: null,
    wallUniforms: [],
    particleUniforms: null,
    displayRoofGrids: null,
    parts: [],
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

function expandGeoBounds(bounds: GeoBounds, ratio = 0.08) {
  const lngPad = Math.max((bounds.east - bounds.west) * ratio, 0.00004);
  const latPad = Math.max((bounds.north - bounds.south) * ratio, 0.00004);
  return {
    west: bounds.west - lngPad,
    east: bounds.east + lngPad,
    south: bounds.south - latPad,
    north: bounds.north + latPad,
  };
}

function pointInGeoBounds(lng: number, lat: number, bounds: GeoBounds) {
  return lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

function ringMatchesGeoBounds(ring: [number, number][], bounds: GeoBounds) {
  const centroid = centroidOfRing(ring);
  if (pointInGeoBounds(centroid.lng, centroid.lat, bounds)) {
    return true;
  }

  const verticesInside = ring.filter(([lng, lat]) => pointInGeoBounds(lng, lat, bounds)).length;
  return verticesInside >= 2;
}

function resolveFootprints(
  map: mapboxgl.Map,
  data: VisualizationSceneResponse,
): { parts: BuildingPart[]; bounds: { minX: number; maxX: number; minZ: number; maxZ: number } } | null {
  try {
    const point = map.project([data.building.lng, data.building.lat]);
    const rendered = map.queryRenderedFeatures(
      [[point.x - 120, point.y - 120], [point.x + 120, point.y + 120]],
      { layers: ["visualization-context-buildings"] },
    );

    const allRings: Array<{ ring: [number, number][]; height: number }> = [];
    rendered.forEach(f => {
      const parsedHeight = Number(f.properties?.height ?? NaN);
      const parsedBase = Number(f.properties?.min_height ?? 0);
      const h = Number.isFinite(parsedHeight) ? Math.max(0, parsedHeight - parsedBase) : data.building.inferredHeightMeters;
      if (f.geometry && f.geometry.type === "Polygon") {
        allRings.push({ ring: f.geometry.coordinates[0] as [number, number][], height: h });
      } else if (f.geometry && f.geometry.type === "MultiPolygon") {
        f.geometry.coordinates.forEach(poly => allRings.push({ ring: poly[0] as [number, number][], height: h }));
      }
    });

    const scopedBoundsList =
      data.solar.sourceBuildings.length > 0
        ? data.solar.sourceBuildings.map((entry) => expandGeoBounds(entry.bounds, 0.05))
        : [expandGeoBounds(data.solar.renderBounds, 0.04)];
    const unfilteredRings = allRings.filter(r => r.ring && r.ring.length >= 3);
    const validRings =
      scopedBoundsList.length > 0
        ? unfilteredRings.filter((ring) => scopedBoundsList.some((bounds) => ringMatchesGeoBounds(ring.ring, bounds)))
        : unfilteredRings;
    const searchRings = validRings.length > 0 ? validRings : unfilteredRings;
    if (searchRings.length === 0) return null;

    const parts: BuildingPart[] = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    
    searchRings.forEach((ringRecord) => {
      const fp = sanitizeFootprint(featureCoordinatesToLocal(ringRecord.ring, data.building.lng, data.building.lat));
      if (fp.length >= 3) {
        parts.push({ ring: fp, height: ringRecord.height });
        fp.forEach(p => {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.z < minZ) minZ = p.z;
          if (p.z > maxZ) maxZ = p.z;
        });
      }
    });

    if (parts.length === 0) return null;
    return { parts, bounds: { minX, maxX, minZ, maxZ } };
  } catch {
    return null;
  }
}

function normalizeGridValues(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value));
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < finite.length; i++) {
    if (finite[i] < min) min = finite[i];
    if (finite[i] > max) max = finite[i];
  }
  const span = Math.max(max - min, 0.0001);
  return values.map((value) => Number(((value - min) / span).toFixed(6)));
}

function getGridMax(values: number[]) {
  let peak = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > peak && Number.isFinite(values[i])) peak = values[i];
  }
  return peak === -Infinity ? 1 : peak;
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
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function centroidOfLocalRing(ring: LocalPoint[]) {
  const sum = ring.reduce((acc, point) => ({ x: acc.x + point.x, z: acc.z + point.z }), { x: 0, z: 0 });
  return { x: sum.x / ring.length, z: sum.z / ring.length };
}

function pointInLocalRing(point: LocalPoint, ring: LocalPoint[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const zi = ring[i].z;
    const xj = ring[j].x;
    const zj = ring[j].z;
    if ((zi > point.z) !== (zj > point.z) && point.x < ((xj - xi) * (point.z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function createLocalProjector(centerLng: number, centerLat: number) {
  const center = mapboxgl.MercatorCoordinate.fromLngLat([centerLng, centerLat], 0);
  const scale = center.meterInMercatorCoordinateUnits();
  const toLngLat = (point: LocalPoint) =>
    new mapboxgl.MercatorCoordinate(
      center.x + point.x * scale,
      center.y - point.z * scale,
      0,
    ).toLngLat();
  const toLocal = (lng: number, lat: number): LocalPoint => {
    const merc = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], 0);
    return {
      x: (merc.x - center.x) / scale,
      z: -(merc.y - center.y) / scale,
    };
  };
  const toUv = (point: LocalPoint, bounds: GeoBounds) => {
    const lngLat = toLngLat(point);
    return {
      u: clamp01((lngLat.lng - bounds.west) / Math.max(bounds.east - bounds.west, 1e-9)),
      v: clamp01((bounds.north - lngLat.lat) / Math.max(bounds.north - bounds.south, 1e-9)),
    };
  };

  return {
    toLocal,
    toLngLat,
    toUv,
  };
}

function localBoundsToGeoBounds(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  centerLng: number,
  centerLat: number,
): GeoBounds {
  const projector = createLocalProjector(centerLng, centerLat);
  const corners = [
    projector.toLngLat({ x: bounds.minX, z: bounds.minZ }),
    projector.toLngLat({ x: bounds.maxX, z: bounds.minZ }),
    projector.toLngLat({ x: bounds.maxX, z: bounds.maxZ }),
    projector.toLngLat({ x: bounds.minX, z: bounds.maxZ }),
  ];

  return {
    west: Math.min(...corners.map((corner) => corner.lng)),
    south: Math.min(...corners.map((corner) => corner.lat)),
    east: Math.max(...corners.map((corner) => corner.lng)),
    north: Math.max(...corners.map((corner) => corner.lat)),
  };
}

function projectPointToSegment(point: LocalPoint, start: LocalPoint, end: LocalPoint) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  const rawT = lengthSq > 0 ? ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSq : 0;
  const t = clamp01(rawT);
  const projected = { x: start.x + dx * t, z: start.z + dz * t };
  return { t, projected, distance: Math.hypot(point.x - projected.x, point.z - projected.z) };
}

function resolveWallKind(normal: LocalPoint): VisualizationSurfaceKind {
  if (Math.abs(normal.x) >= Math.abs(normal.z)) {
    return normal.x >= 0 ? "east_wall" : "west_wall";
  }
  return normal.z >= 0 ? "south_wall" : "north_wall";
}

function createRoofShaderMaterial(
  solarTexture: THREE.DataTexture,
  observedTexture: THREE.DataTexture,
  thermalTexture: THREE.DataTexture,
  coverageTexture: THREE.DataTexture,
  confidenceTexture: THREE.DataTexture,
) {
  const uniforms = {
    uSolar: { value: solarTexture },
    uObservedSolar: { value: observedTexture },
    uThermal: { value: thermalTexture },
    uCoverage: { value: coverageTexture },
    uConfidence: { value: confidenceTexture },
    uOverlayMode: { value: 2 },
    uOpacity: { value: 1 },
    uTime: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
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
      uniform sampler2D uObservedSolar;
      uniform sampler2D uThermal;
      uniform sampler2D uCoverage;
      uniform sampler2D uConfidence;
      uniform float uOverlayMode;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormal;

      vec3 solarRamp(float t) {
        float s = clamp(t, 0.0, 1.0);
        vec3 cold = vec3(0.24, 0.18, 0.72);
        vec3 cool = vec3(0.18, 0.42, 0.95);
        vec3 warm = vec3(0.98, 0.9, 0.2);
        vec3 hot = vec3(1.0, 0.36, 0.08);
        return
          s < 0.32 ? mix(cold, cool, s / 0.32) :
          s < 0.7 ? mix(cool, warm, (s - 0.32) / 0.38) :
          mix(warm, hot, (s - 0.7) / 0.3);
      }

      vec3 thermalRamp(float t) {
        float s = clamp(t, 0.0, 1.0);
        vec3 cold  = vec3(0.2, 0.4, 0.9);
        vec3 hot   = vec3(0.95, 0.2, 0.1);
        return mix(cold, hot, s);
      }

      void main() {
        float coverage = texture2D(uCoverage, vUv).r;
        float confidence = texture2D(uConfidence, vUv).r;
        float solar = pow(clamp(texture2D(uSolar, vUv).r, 0.0, 1.0), 0.92);
        float observed = pow(clamp(texture2D(uObservedSolar, vUv).r, 0.0, 1.0), 0.96);
        float thermal = texture2D(uThermal, vUv).r;
        vec3 solarColor = solarRamp(solar);
        vec3 observedColor = solarRamp(observed);
        vec3 thermalColor = thermalRamp(thermal);
        vec3 softSky = vec3(0.7, 0.75, 0.82);
        float detailMask = smoothstep(0.05, 0.32, coverage);
        vec3 roofSolar = mix(mix(solarColor, softSky, 0.08), solarColor, smoothstep(0.72, 0.96, confidence));
        roofSolar = mix(roofSolar, observedColor, detailMask * 0.48);

        vec2 gridUv = fract(vUv * vec2(24.0, 24.0));
        float gridLine = max(
          1.0 - smoothstep(0.44, 0.5, abs(gridUv.x - 0.5) * 2.0),
          1.0 - smoothstep(0.44, 0.5, abs(gridUv.y - 0.5) * 2.0)
        );
        float detailEdge = clamp(fwidth(observed) * 14.0, 0.0, 1.0);
        roofSolar += vec3(0.92, 0.98, 1.0) * gridLine * (0.018 + 0.016 * solar);
        roofSolar += vec3(1.0, 0.96, 0.72) * detailEdge * detailMask * 0.18;

        vec3 baseColor =
          uOverlayMode < 0.5
            ? roofSolar
            : uOverlayMode < 1.5
              ? mix(roofSolar, thermalColor, 0.56)
              : mix(roofSolar, thermalColor, 0.24);
        float contour = smoothstep(0.8, 1.0, sin((solar * 9.0 + observed * 7.0 + thermal * 4.4 + vUv.x * 5.5 - vUv.y * 6.0) + uTime * 0.42) * 0.5 + 0.5);
        baseColor += vec3(1.0, 0.94, 0.55) * contour * confidence * 0.06;
        vec3 lightDir = normalize(vec3(0.4, 0.85, 0.3));
        float shade = 0.55 + max(dot(normalize(vNormal), lightDir), 0.0) * 0.45;
        float alpha = mix(0.88, 0.96, confidence);
        gl_FragColor = vec4(baseColor * shade, uOpacity * alpha);
      }
    `,
  });

  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;

  return { material, uniforms };
}

function createWallShaderMaterial(
  thermalTexture: THREE.DataTexture,
  hotspots: number[],
) {
  const paddedHotspots = [...hotspots].slice(0, 4);
  while (paddedHotspots.length < 4) {
    paddedHotspots.push(-10);
  }

  const uniforms = {
    uThermal: { value: thermalTexture },
    uVisible: { value: 1 },
    uTime: { value: 0 },
    uHotspots: { value: paddedHotspots },
    uHotspotCount: { value: Math.min(hotspots.length, 4) },
  };

  const material = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
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
      uniform sampler2D uThermal;
      uniform float uVisible;
      uniform float uTime;
      uniform float uHotspotCount;
      uniform float uHotspots[4];
      varying vec2 vUv;
      varying vec3 vNormal;

      vec3 thermalRamp(float t) {
        float s = clamp(t, 0.0, 1.0);
        vec3 cold = vec3(0.18, 0.42, 0.98);
        vec3 mid = vec3(1.0, 0.8, 0.22);
        vec3 hot = vec3(1.0, 0.26, 0.08);
        return s < 0.58 ? mix(cold, mid, s / 0.58) : mix(mid, hot, (s - 0.58) / 0.42);
      }

      void main() {
        float thermal = texture2D(uThermal, vec2(vUv.x, 1.0 - vUv.y)).r;
        float pulse = sin(vUv.y * 14.0 - uTime * 1.4 + vUv.x * 8.0) * 0.5 + 0.5;
        float hotspotGlow = 0.0;
        for (int i = 0; i < 4; i++) {
          if (float(i) < uHotspotCount) {
            float spread = exp(-pow((vUv.x - uHotspots[i]) * 12.0, 2.0));
            float plume = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.22, 0.85, vUv.y));
            hotspotGlow += spread * plume;
          }
        }
        float edgeGlow = pow(1.0 - abs(vUv.x * 2.0 - 1.0), 0.6);
        vec3 color = thermalRamp(thermal);
        color += vec3(1.0, 0.92, 0.62) * hotspotGlow * (0.3 + pulse * 0.24);
        color += vec3(1.0, 0.7, 0.28) * edgeGlow * 0.04;
        float shade = 0.72 + max(dot(normalize(vNormal), normalize(vec3(0.35, 0.8, 0.25))), 0.0) * 0.28;
        float alpha = (0.08 + thermal * 0.26 + hotspotGlow * 0.22) * uVisible;
        alpha *= smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.68, vUv.y);
        gl_FragColor = vec4(color * shade, clamp(alpha, 0.0, 0.58));
      }
    `,
  });

  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;

  return { material, uniforms };
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

function getGridRectForMask(
  maskGrid: VisualizationGrid,
  threshold = 0.05,
) {
  let minCol = maskGrid.width;
  let minRow = maskGrid.height;
  let maxCol = -1;
  let maxRow = -1;

  for (let row = 0; row < maskGrid.height; row += 1) {
    for (let col = 0; col < maskGrid.width; col += 1) {
      const value = maskGrid.values[row * maskGrid.width + col];
      if (value > threshold) {
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
        if (row < minRow) minRow = row;
        if (row > maxRow) maxRow = row;
      }
    }
  }

  if (maxCol < minCol || maxRow < minRow) {
    return null;
  }

  const padX = Math.max(2, Math.round((maxCol - minCol + 1) * 0.05));
  const padY = Math.max(2, Math.round((maxRow - minRow + 1) * 0.05));
  return {
    minCol: Math.max(0, minCol - padX),
    maxCol: Math.min(maskGrid.width - 1, maxCol + padX),
    minRow: Math.max(0, minRow - padY),
    maxRow: Math.min(maskGrid.height - 1, maxRow + padY),
  };
}

function scaleRectToGrid(
  rect: { minCol: number; maxCol: number; minRow: number; maxRow: number },
  source: VisualizationGrid,
  target: VisualizationGrid,
) {
  if (source.width === target.width && source.height === target.height) {
    return rect;
  }

  return {
    minCol: Math.max(0, Math.floor((rect.minCol / Math.max(1, source.width - 1)) * Math.max(1, target.width - 1))),
    maxCol: Math.min(target.width - 1, Math.ceil((rect.maxCol / Math.max(1, source.width - 1)) * Math.max(1, target.width - 1))),
    minRow: Math.max(0, Math.floor((rect.minRow / Math.max(1, source.height - 1)) * Math.max(1, target.height - 1))),
    maxRow: Math.min(target.height - 1, Math.ceil((rect.maxRow / Math.max(1, source.height - 1)) * Math.max(1, target.height - 1))),
  };
}

function boundsForGridRect(
  bounds: GeoBounds,
  grid: VisualizationGrid,
  rect: { minCol: number; maxCol: number; minRow: number; maxRow: number },
): GeoBounds {
  const lngSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;

  return {
    west: bounds.west + (rect.minCol / Math.max(grid.width, 1)) * lngSpan,
    east: bounds.west + ((rect.maxCol + 1) / Math.max(grid.width, 1)) * lngSpan,
    north: bounds.north - (rect.minRow / Math.max(grid.height, 1)) * latSpan,
    south: bounds.north - ((rect.maxRow + 1) / Math.max(grid.height, 1)) * latSpan,
  };
}

function cropGrid(
  grid: VisualizationGrid,
  rect: { minCol: number; maxCol: number; minRow: number; maxRow: number },
): VisualizationGrid {
  const width = rect.maxCol - rect.minCol + 1;
  const height = rect.maxRow - rect.minRow + 1;
  const values: number[] = [];

  for (let row = rect.minRow; row <= rect.maxRow; row += 1) {
    for (let col = rect.minCol; col <= rect.maxCol; col += 1) {
      values.push(grid.values[row * grid.width + col]);
    }
  }

  return { width, height, values };
}

function smoothMaskedGrid(
  grid: VisualizationGrid,
  maskGrid: VisualizationGrid,
  passes = 5,
) {
  if (grid.width !== maskGrid.width || grid.height !== maskGrid.height) {
    return grid;
  }

  let values = [...grid.values];
  const offsets = [
    [-1, -1, 0.7],
    [0, -1, 1],
    [1, -1, 0.7],
    [-1, 0, 1],
    [1, 0, 1],
    [-1, 1, 0.7],
    [0, 1, 1],
    [1, 1, 0.7],
  ] as const;

  for (let pass = 0; pass < passes; pass += 1) {
    const next = [...values];

    for (let row = 0; row < grid.height; row += 1) {
      for (let col = 0; col < grid.width; col += 1) {
        const index = row * grid.width + col;
        if (maskGrid.values[index] <= 0.04) {
          next[index] = 0;
          continue;
        }

        let sum = values[index] * 1.8;
        let weight = 1.8;

        offsets.forEach(([dx, dy, neighborWeight]) => {
          const nextCol = col + dx;
          const nextRow = row + dy;
          if (nextCol < 0 || nextCol >= grid.width || nextRow < 0 || nextRow >= grid.height) {
            return;
          }

          const neighborIndex = nextRow * grid.width + nextCol;
          if (maskGrid.values[neighborIndex] <= 0.04) {
            return;
          }

          sum += values[neighborIndex] * neighborWeight;
          weight += neighborWeight;
        });

        next[index] = sum / Math.max(weight, 1e-6);
      }
    }

    values = next;
  }

  return {
    ...grid,
    values: values.map((value, index) => (maskGrid.values[index] > 0.04 ? Number(value.toFixed(6)) : 0)),
  };
}

function smoothGrid(
  grid: VisualizationGrid,
  passes = 2,
) {
  let values = [...grid.values];
  const offsets = [
    [-1, -1, 0.7],
    [0, -1, 1],
    [1, -1, 0.7],
    [-1, 0, 1],
    [1, 0, 1],
    [-1, 1, 0.7],
    [0, 1, 1],
    [1, 1, 0.7],
  ] as const;

  for (let pass = 0; pass < passes; pass += 1) {
    const next = [...values];

    for (let row = 0; row < grid.height; row += 1) {
      for (let col = 0; col < grid.width; col += 1) {
        const index = row * grid.width + col;
        let sum = values[index] * 1.8;
        let weight = 1.8;

        offsets.forEach(([dx, dy, neighborWeight]) => {
          const nextCol = col + dx;
          const nextRow = row + dy;
          if (nextCol < 0 || nextCol >= grid.width || nextRow < 0 || nextRow >= grid.height) {
            return;
          }

          const neighborIndex = nextRow * grid.width + nextCol;
          sum += values[neighborIndex] * neighborWeight;
          weight += neighborWeight;
        });

        next[index] = sum / Math.max(weight, 1e-6);
      }
    }

    values = next;
  }

  return {
    ...grid,
    values: values.map((value) => Number(value.toFixed(6))),
  };
}

function sampleGrid(grid: VisualizationGrid, u: number, v: number) {
  const x = Math.min(grid.width - 1, Math.max(0, u * (grid.width - 1)));
  const y = Math.min(grid.height - 1, Math.max(0, (1 - v) * (grid.height - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(grid.width - 1, x0 + 1);
  const y1 = Math.min(grid.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;

  const topLeft = grid.values[y0 * grid.width + x0];
  const topRight = grid.values[y0 * grid.width + x1];
  const bottomLeft = grid.values[y1 * grid.width + x0];
  const bottomRight = grid.values[y1 * grid.width + x1];
  const top = topLeft * (1 - tx) + topRight * tx;
  const bottom = bottomLeft * (1 - tx) + bottomRight * tx;
  return top * (1 - ty) + bottom * ty;
}

function resampleGridToBounds(
  grid: VisualizationGrid,
  fromBounds: GeoBounds,
  toBounds: GeoBounds,
  width: number,
  height: number,
) {
  const values: number[] = [];

  for (let row = 0; row < height; row += 1) {
    const v = 1 - (row + 0.5) / height;
    const lat = toBounds.south + (toBounds.north - toBounds.south) * v;
    const sourceV = (lat - fromBounds.south) / Math.max(fromBounds.north - fromBounds.south, 1e-9);

    for (let col = 0; col < width; col += 1) {
      const u = (col + 0.5) / width;
      const lng = toBounds.west + (toBounds.east - toBounds.west) * u;
      const sourceU = (lng - fromBounds.west) / Math.max(fromBounds.east - fromBounds.west, 1e-9);
      values.push(Number(sampleGrid(grid, clamp01(sourceU), clamp01(sourceV)).toFixed(6)));
    }
  }

  return { width, height, values };
}

function isReasonableGeoBounds(bounds: GeoBounds | null | undefined) {
  if (!bounds) {
    return false;
  }
  return (
    Number.isFinite(bounds.west) &&
    Number.isFinite(bounds.east) &&
    Number.isFinite(bounds.south) &&
    Number.isFinite(bounds.north) &&
    Math.abs(bounds.west) <= 180 &&
    Math.abs(bounds.east) <= 180 &&
    Math.abs(bounds.south) <= 90 &&
    Math.abs(bounds.north) <= 90 &&
    bounds.east > bounds.west &&
    bounds.north > bounds.south
  );
}

function prepareRoofGrids(
  solar: SolarVisualization,
  month: number,
) {
  return {
    solarGrid: smoothGrid(getMonthlyGrid(solar, month), 1),
    observedSolarGrid: getObservedMonthlyGrid(solar, month),
    coverageGrid: solar.coverageGrid,
    confidenceGrid: solar.confidenceGrid,
    renderBounds: solar.renderBounds,
  };
}

function fitRoofGridsToShell(
  roofGrids: {
    solarGrid: VisualizationGrid;
    observedSolarGrid: VisualizationGrid;
    coverageGrid: VisualizationGrid;
    confidenceGrid: VisualizationGrid;
    renderBounds: GeoBounds;
  },
  shellBounds: GeoBounds,
) {
  const sourceRect = getGridRectForMask(roofGrids.coverageGrid, 0.08);
  if (!sourceRect) {
    return {
      ...roofGrids,
      renderBounds: shellBounds,
    };
  }

  const scaledSolarRect = scaleRectToGrid(sourceRect, roofGrids.coverageGrid, roofGrids.solarGrid);
  const scaledObservedRect = scaleRectToGrid(sourceRect, roofGrids.coverageGrid, roofGrids.observedSolarGrid);
  const scaledConfidenceRect = scaleRectToGrid(sourceRect, roofGrids.coverageGrid, roofGrids.confidenceGrid);
  const croppedBounds = boundsForGridRect(roofGrids.renderBounds, roofGrids.coverageGrid, sourceRect);
  const croppedSolarGrid = cropGrid(roofGrids.solarGrid, scaledSolarRect);
  const croppedObservedGrid = cropGrid(roofGrids.observedSolarGrid, scaledObservedRect);
  const croppedCoverageGrid = cropGrid(roofGrids.coverageGrid, sourceRect);
  const croppedConfidenceGrid = cropGrid(roofGrids.confidenceGrid, scaledConfidenceRect);
  const width = roofGrids.solarGrid.width;
  const height = roofGrids.solarGrid.height;

  return {
    solarGrid: smoothGrid(
      resampleGridToBounds(croppedSolarGrid, croppedBounds, shellBounds, width, height),
      1,
    ),
    observedSolarGrid: resampleGridToBounds(
      croppedObservedGrid,
      croppedBounds,
      shellBounds,
      width,
      height,
    ),
    coverageGrid: resampleGridToBounds(croppedCoverageGrid, croppedBounds, shellBounds, width, height),
    confidenceGrid: resampleGridToBounds(croppedConfidenceGrid, croppedBounds, shellBounds, width, height),
    renderBounds: shellBounds,
  };
}

function buildRoofGroup(
  parts: BuildingPart[],
  material: THREE.Material,
  centerLng: number,
  centerLat: number,
  renderBounds: GeoBounds,
) {
  const projector = createLocalProjector(centerLng, centerLat);
  return parts.map((part) => {
    const shape = new THREE.Shape();
    part.ring.forEach((point, index) => {
      if (index === 0) {
        shape.moveTo(point.x, point.z);
      } else {
        shape.lineTo(point.x, point.z);
      }
    });
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape);
    const positions = geometry.attributes.position;
    const uvs = new Float32Array(positions.count * 2);
    for (let index = 0; index < positions.count; index += 1) {
      const point = { x: positions.getX(index), z: positions.getY(index) };
      const uv = projector.toUv(point, renderBounds);
      uvs[index * 2] = uv.u;
      uvs[index * 2 + 1] = uv.v;
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, part.height + 0.62, 0);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2;
    mesh.userData.kind = "roof";
    mesh.userData.visualization = true;
    return mesh;
  });
}

function buildExteriorEdges(
  parts: BuildingPart[],
  thermalSurfaces: ReturnType<typeof applyScenarioToThermal>,
  entrances: VisualizationSceneResponse["entrances"],
  centerLng: number,
  centerLat: number,
) {
  const projector = createLocalProjector(centerLng, centerLat);
  const localEntrances = entrances.map((entry) => ({
    ...entry,
    point: projector.toLocal(entry.lng, entry.lat),
  }));
  const surfaceFluxByKind = Object.fromEntries(
    thermalSurfaces.map((surface) => [surface.kind, Math.max(0, surface.baseFluxWm2)]),
  ) as Record<string, number>;

  const edges = new globalThis.Map<string, {
    start: LocalPoint;
    end: LocalPoint;
    height: number;
    centroid: LocalPoint;
    count: number;
  }>();

  parts.forEach((part) => {
    const centroid = centroidOfLocalRing(part.ring);
    for (let i = 0; i < part.ring.length; i += 1) {
      const start = part.ring[i];
      const end = part.ring[(i + 1) % part.ring.length];
      const key = [
        `${Math.min(start.x, end.x).toFixed(2)},${Math.min(start.z, end.z).toFixed(2)}`,
        `${Math.max(start.x, end.x).toFixed(2)},${Math.max(start.z, end.z).toFixed(2)}`,
      ].join("-");
      const existing = edges.get(key);
      if (existing) {
        existing.count += 1;
        existing.height = Math.max(existing.height, part.height);
      } else {
        edges.set(key, {
          start,
          end,
          height: part.height,
          centroid,
          count: 1,
        });
      }
    }
  });

  return Array.from(edges.values())
    .filter((edge) => edge.count === 1)
    .map((edge) => {
      const dx = edge.end.x - edge.start.x;
      const dz = edge.end.z - edge.start.z;
      const length = Math.hypot(dx, dz);
      const tangent = length > 0 ? { x: dx / length, z: dz / length } : { x: 1, z: 0 };
      const midpoint = {
        x: (edge.start.x + edge.end.x) * 0.5,
        z: (edge.start.z + edge.end.z) * 0.5,
      };
      const normalOptions = [
        { x: tangent.z, z: -tangent.x },
        { x: -tangent.z, z: tangent.x },
      ];
      const normal =
        normalOptions[0].x * (midpoint.x - edge.centroid.x) +
          normalOptions[0].z * (midpoint.z - edge.centroid.z) >
        normalOptions[1].x * (midpoint.x - edge.centroid.x) +
          normalOptions[1].z * (midpoint.z - edge.centroid.z)
          ? normalOptions[0]
          : normalOptions[1];

      const kind = resolveWallKind(normal);
      const hotspots = localEntrances
        .map((entry) => ({ entry, ...projectPointToSegment(entry.point, edge.start, edge.end) }))
        .filter((candidate) => candidate.distance <= 4.2)
        .map((candidate) => candidate.t)
        .sort((a, b) => a - b)
        .filter((value, index, list) => index === 0 || Math.abs(value - list[index - 1]) > 0.08)
        .slice(0, 4);

      const emitterWeight = clamp01((surfaceFluxByKind[kind] ?? 0) / 32);
      return {
        start: edge.start,
        end: edge.end,
        height: edge.height,
        kind,
        normal,
        tangent,
        length,
        hotspots,
        emitterWeight,
      } satisfies ExteriorEdge;
    });
}

function buildWallMeshes(
  exteriorEdges: ExteriorEdge[],
  thermalSurfaces: ReturnType<typeof applyScenarioToThermal>,
) {
  const surfaceMap = new globalThis.Map(thermalSurfaces.map((surface) => [surface.kind, surface]));
  const meshes: THREE.Mesh[] = [];
  const uniforms: Array<Record<string, THREE.IUniform<unknown>>> = [];
  const textures: Partial<Record<string, THREE.DataTexture>> = {};

  exteriorEdges.forEach((edge) => {
    const surface = surfaceMap.get(edge.kind);
    if (!surface || edge.length < 1.5) {
      return;
    }

    const texture = textures[edge.kind] ?? createThermalGridTexture(surface);
    textures[edge.kind] = texture;
    const { material, uniforms: wallUniforms } = createWallShaderMaterial(
      texture,
      edge.hotspots,
    );

    const outwardOffset = 0.55;
    const heightInset = 0.2;
    const baseStart = {
      x: edge.start.x + edge.normal.x * outwardOffset,
      z: edge.start.z + edge.normal.z * outwardOffset,
    };
    const baseEnd = {
      x: edge.end.x + edge.normal.x * outwardOffset,
      z: edge.end.z + edge.normal.z * outwardOffset,
    };

    const geometry = new THREE.BufferGeometry();
    const positions = Float32Array.from([
      baseStart.x, heightInset, baseStart.z,
      baseEnd.x, heightInset, baseEnd.z,
      baseStart.x, edge.height + 0.45, baseStart.z,
      baseEnd.x, edge.height + 0.45, baseEnd.z,
    ]);
    const uv = Float32Array.from([
      0, 0,
      1, 0,
      0, 1,
      1, 1,
    ]);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2;
    mesh.userData.kind = edge.kind;
    mesh.userData.visualization = true;
    meshes.push(mesh);
    uniforms.push(wallUniforms);
  });

  return { meshes, uniforms, textures };
}

function createParticleSystem(exteriorEdges: ExteriorEdge[]) {
  const positions: number[] = [];
  const progressValues: number[] = [];
  const seeds: number[] = [];
  const intensities: number[] = [];
  const coolness: number[] = [];
  const sizes: number[] = [];

  const coolEdges = exteriorEdges
    .filter((edge) => edge.hotspots.length > 0 && edge.length >= 3)
    .sort((a, b) => b.hotspots.length * b.length - a.hotspots.length * a.length)
    .slice(0, 3);
  const warmEdges = (
    coolEdges.length > 0
      ? coolEdges
      : exteriorEdges
          .filter((edge) => edge.length >= 8 && edge.emitterWeight >= 0.14)
          .sort((a, b) => b.emitterWeight * b.length - a.emitterWeight * a.length)
          .slice(0, 3)
  );

  const streams = [
    ...warmEdges.flatMap((edge) => {
      const emitters = edge.hotspots.length > 0 ? edge.hotspots.slice(0, 2) : edge.length > 22 ? [0.3, 0.7] : [0.5];
      return emitters.map((t, index) => ({ edge, t, index, cool: false }));
    }),
    ...(
      coolEdges.length > 0
        ? coolEdges.flatMap((edge) => edge.hotspots.slice(0, 2).map((t, index) => ({ edge, t, index, cool: true })))
        : exteriorEdges
            .filter((edge) => edge.length >= 12)
            .sort((a, b) => a.emitterWeight - b.emitterWeight || b.length - a.length)
            .slice(0, 2)
            .map((edge) => ({ edge, t: 0.5, index: 0, cool: true }))
    ),
  ];

  streams.forEach(({ edge, t, index, cool }, streamIndex) => {
    const baseAnchor = {
      x: edge.start.x + (edge.end.x - edge.start.x) * t,
      z: edge.start.z + (edge.end.z - edge.start.z) * t,
    };
    const filamentCount = cool ? 2 : 2;
    for (let filament = 0; filament < filamentCount; filament += 1) {
      const spread = filament - (filamentCount - 1) * 0.5;
      const seed = streamIndex * 0.43 + index * 0.37 + filament * 0.19;
      const anchor = {
        x: baseAnchor.x + edge.tangent.x * spread * (cool ? 0.95 : 1.2),
        z: baseAnchor.z + edge.tangent.z * spread * (cool ? 0.95 : 1.2),
      };
      const wallBaseY = Math.min(Math.max(edge.height * 0.16, 1.8), 4.2);
      const warmStart = new THREE.Vector3(
        anchor.x + edge.normal.x * 0.45,
        wallBaseY,
        anchor.z + edge.normal.z * 0.45,
      );
      const warmCp1 = new THREE.Vector3(
        warmStart.x + edge.normal.x * (4.2 + edge.emitterWeight * 2.2) + edge.tangent.x * spread * 1.4,
        wallBaseY + 1.4,
        warmStart.z + edge.normal.z * (4.2 + edge.emitterWeight * 2.2) + edge.tangent.z * spread * 1.4,
      );
      const warmCp2 = new THREE.Vector3(
        warmStart.x + edge.normal.x * (10.5 + edge.emitterWeight * 4.5) + edge.tangent.x * spread * 2.6,
        wallBaseY + 5.5 + edge.emitterWeight * 2.2,
        warmStart.z + edge.normal.z * (10.5 + edge.emitterWeight * 4.5) + edge.tangent.z * spread * 2.6,
      );
      const warmEnd = new THREE.Vector3(
        warmStart.x + edge.normal.x * (17 + edge.emitterWeight * 7.5) + edge.tangent.x * spread * 4.2,
        wallBaseY + 10 + edge.emitterWeight * 4.5,
        warmStart.z + edge.normal.z * (17 + edge.emitterWeight * 7.5) + edge.tangent.z * spread * 4.2,
      );
      const coolStart = new THREE.Vector3(
        anchor.x - edge.normal.x * 12.5 + edge.tangent.x * spread * 1.8,
        wallBaseY + 1.2,
        anchor.z - edge.normal.z * 12.5 + edge.tangent.z * spread * 1.8,
      );
      const coolCp1 = new THREE.Vector3(
        anchor.x - edge.normal.x * 8 + edge.tangent.x * spread * 1.3,
        wallBaseY + 2.6,
        anchor.z - edge.normal.z * 8 + edge.tangent.z * spread * 1.3,
      );
      const coolCp2 = new THREE.Vector3(
        anchor.x - edge.normal.x * 3.8 + edge.tangent.x * spread * 0.8,
        wallBaseY + 1.4,
        anchor.z - edge.normal.z * 3.8 + edge.tangent.z * spread * 0.8,
      );
      const coolEnd = new THREE.Vector3(
        anchor.x - edge.normal.x * 0.15,
        wallBaseY + 0.4,
        anchor.z - edge.normal.z * 0.15,
      );
      const curve = cool
        ? new THREE.CatmullRomCurve3([coolStart, coolCp1, coolCp2, coolEnd])
        : new THREE.CatmullRomCurve3([warmStart, warmCp1, warmCp2, warmEnd]);
      const pointCount = cool ? 22 : 26;
      for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        const progress = pointIndex / Math.max(pointCount - 1, 1);
        const point = curve.getPoint(progress);
        positions.push(point.x, point.y, point.z);
        progressValues.push(progress);
        seeds.push(seed);
        intensities.push(cool ? 0.46 : 0.58 + edge.emitterWeight * 0.34);
        coolness.push(cool ? 1 : 0);
        sizes.push(cool ? 3.8 - progress * 1.2 : 4.2 - progress * 1.4);
      }
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aProgress", new THREE.Float32BufferAttribute(progressValues, 1));
  geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
  geometry.setAttribute("aIntensity", new THREE.Float32BufferAttribute(intensities, 1));
  geometry.setAttribute("aCool", new THREE.Float32BufferAttribute(coolness, 1));
  geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));

  const uniforms = {
    uTime: { value: 0 },
    uVisible: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    uniforms,
    vertexShader: `
      attribute float aProgress;
      attribute float aSeed;
      attribute float aIntensity;
      attribute float aCool;
      attribute float aSize;
      varying float vProgress;
      varying float vSeed;
      varying float vIntensity;
      varying float vCool;
      void main() {
        vProgress = aProgress;
        vSeed = aSeed;
        vIntensity = aIntensity;
        vCool = aCool;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * (165.0 / max(18.0, -mvPosition.z));
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uVisible;
      varying float vProgress;
      varying float vSeed;
      varying float vIntensity;
      varying float vCool;

      void main() {
        vec2 centered = gl_PointCoord - 0.5;
        float radial = 1.0 - smoothstep(0.14, 0.5, length(centered));
        float speed = mix(0.16, 0.28, clamp(vIntensity, 0.0, 1.0));
        float phase = fract(vProgress * mix(1.3, 1.75, vCool) - uTime * speed + vSeed);
        float pulse = exp(-pow((phase - 0.2) * 9.5, 2.0));
        float trail = smoothstep(0.0, 0.06, vProgress) * smoothstep(1.0, 0.7, vProgress);
        float shimmer = sin(vSeed * 19.0 + uTime * 2.4 + vProgress * 10.0) * 0.5 + 0.5;
        vec3 warm = mix(vec3(0.96, 0.54, 0.12), vec3(1.0, 0.78, 0.22), 0.32 + shimmer * 0.12);
        vec3 cool = mix(vec3(0.0, 0.72, 0.92), vec3(0.18, 0.94, 1.0), 0.28 + shimmer * 0.12);
        vec3 color = mix(warm, cool, vCool);
        color += mix(vec3(0.32, 0.1, 0.0), vec3(0.0, 0.26, 0.62), vCool) * pulse * 0.14;
        float alpha = radial * trail * (0.08 + pulse * 0.48) * (0.56 + vIntensity * 0.24) * uVisible;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.renderOrder = 4;
  return { points, uniforms };
}

function getMonthlyGrid(solar: SolarVisualization, month: number) {
  if (month > 0) {
    return solar.monthlyFluxGrids.find((grid) => grid.month === month) ?? solar.annualFluxGrid;
  }
  return solar.annualFluxGrid;
}

function getObservedMonthlyGrid(solar: SolarVisualization, month: number) {
  if (month > 0) {
    return solar.observedMonthlyFluxGrids.find((grid) => grid.month === month) ?? solar.observedSolarGrid;
  }
  return solar.observedSolarGrid;
}

function createHoverDetail(
  thermalSurfaces: ReturnType<typeof applyScenarioToThermal>,
  solarGrid: VisualizationGrid,
  coverageGrid: VisualizationGrid,
  confidenceGrid: VisualizationGrid,
  object: THREE.Object3D,
  uv: THREE.Vector2,
): HoverPayload {
  const kind = object.userData.kind as string | undefined;
  if (!kind) {
    return null;
  }

  if (kind === "roof") {
    const col = Math.min(solarGrid.width - 1, Math.max(0, Math.floor(uv.x * solarGrid.width)));
    const row = Math.min(solarGrid.height - 1, Math.max(0, Math.floor((1 - uv.y) * solarGrid.height)));
    const index = row * solarGrid.width + col;
    const maskCol = Math.min(coverageGrid.width - 1, Math.max(0, Math.floor(uv.x * coverageGrid.width)));
    const maskRow = Math.min(coverageGrid.height - 1, Math.max(0, Math.floor((1 - uv.y) * coverageGrid.height)));
    const flux = solarGrid.values[index];
    const coverage = coverageGrid.values[maskRow * coverageGrid.width + maskCol];
    const confidence = confidenceGrid.values[maskRow * confidenceGrid.width + maskCol];
    return {
      title: "Roof solar patch",
      detail:
        coverage > 0.08
          ? `Observed Google Solar flux ${flux.toFixed(1)} kWh/kW/yr equivalent, relative suitability ${(flux / getGridMax(solarGrid.values)).toFixed(2)}.`
          : `Low-confidence continuation region. Confidence ${(confidence * 100).toFixed(0)}%. Direct Google roof coverage is sparse here.`,
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

function disposeVisualizationObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Points) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
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
  const rebuildSceneRef = useRef<() => void>(() => {});
  const mouseRef = useRef(new THREE.Vector2(0, 0));
  const hoverDirtyRef = useRef(false);

  const thermalSurfaces = useMemo(
    () => applyScenarioToThermal(data.thermal, scenario, month || 7),
    [data, scenario, month],
  );
  const roofGrids = useMemo(() => prepareRoofGrids(data.solar, month), [data.solar, month]);

  const rebuildScene = useCallback(() => {
    const layerState = layerStateRef.current;
    if (!layerState.scene || !layerState.map) {
      return;
    }

    [...layerState.scene.children]
      .filter((child) => child.userData.visualization)
      .forEach((child) => {
        layerState.scene?.remove(child);
        disposeVisualizationObject(child);
      });
    Object.values(layerState.wallThermalTextures).forEach((texture) => texture?.dispose());
    layerState.roofSolarTexture?.dispose();
    layerState.roofObservedTexture?.dispose();
    layerState.roofCoverageTexture?.dispose();
    layerState.roofConfidenceTexture?.dispose();
    layerState.roofThermalTexture?.dispose();
    layerState.wallThermalTextures = {};
    layerState.wallUniforms = [];
    layerState.wallMeshes = [];
    layerState.hoverables = [];
    layerState.roofUniforms = null;
    layerState.particleUniforms = null;
    layerState.particleSystem = null;
    layerState.roofMesh = null;
    layerState.displayRoofGrids = null;

    const footprintResult = resolveFootprints(layerState.map, data);
    let parts: BuildingPart[];
    let bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
    if (!footprintResult) {
      const retryOnIdle = () => {
        layerState.map?.off("idle", retryOnIdle);
        rebuildSceneRef.current();
      };
      layerState.map.on("idle", retryOnIdle);
      const tempFootprint = getRectangleFootprint(data.building.squareFeet, data.building.floors);
      parts = [{ ring: tempFootprint, height: data.building.inferredHeightMeters }];
      bounds = {
        minX: Math.min(...tempFootprint.map((p) => p.x)),
        maxX: Math.max(...tempFootprint.map((p) => p.x)),
        minZ: Math.min(...tempFootprint.map((p) => p.z)),
        maxZ: Math.max(...tempFootprint.map((p) => p.z)),
      };
    } else {
      ({ parts, bounds } = footprintResult);
    }
    layerState.parts = parts;
    layerState.footprintLimits = bounds;
    const shellGeoBounds = localBoundsToGeoBounds(bounds, data.building.lng, data.building.lat);
    const displayRoofGrids = fitRoofGridsToShell(roofGrids, shellGeoBounds);
    layerState.displayRoofGrids = displayRoofGrids;

    const roofSolarTexture = createTexture(displayRoofGrids.solarGrid, true);
    const roofObservedTexture = createTexture(displayRoofGrids.observedSolarGrid, true);
    const roofCoverageTexture = createTexture(displayRoofGrids.coverageGrid, false);
    const roofConfidenceTexture = createTexture(displayRoofGrids.confidenceGrid, false);
    const roofThermalTexture = createThermalGridTexture(
      thermalSurfaces.find((surface) => surface.kind === "roof") ?? thermalSurfaces[0],
    );

    layerState.roofSolarTexture = roofSolarTexture;
    layerState.roofObservedTexture = roofObservedTexture;
    layerState.roofCoverageTexture = roofCoverageTexture;
    layerState.roofConfidenceTexture = roofConfidenceTexture;
    layerState.roofThermalTexture = roofThermalTexture;

    // Mapbox handles the 3D building body via fill-extrusion.
    // Three.js only adds overlay layers: roof heatmap, wall thermal, particles.

    // --- Roof overlay (solar + thermal heatmap) ---
    const { material: roofMaterial, uniforms: roofUniforms } = createRoofShaderMaterial(
      roofSolarTexture,
      roofObservedTexture,
      roofThermalTexture,
      roofCoverageTexture,
      roofConfidenceTexture,
    );
    const roofMeshes = buildRoofGroup(
      parts,
      roofMaterial,
      data.building.lng,
      data.building.lat,
      displayRoofGrids.renderBounds,
    );
    layerState.roofMesh = roofMeshes[0] ?? null;
    layerState.roofUniforms = roofUniforms;
    roofMeshes.forEach((mesh) => layerState.scene?.add(mesh));

    // --- Wall thermal surfaces + streamlines ---
    const exteriorEdges = buildExteriorEdges(
      parts,
      thermalSurfaces,
      data.entrances,
      data.building.lng,
      data.building.lat,
    );
    const { meshes: wallMeshes, uniforms: wallUniforms, textures: wallTextures } = buildWallMeshes(
      exteriorEdges,
      thermalSurfaces,
    );
    layerState.wallMeshes = wallMeshes;
    layerState.wallUniforms = wallUniforms;
    layerState.wallThermalTextures = wallTextures;
    wallMeshes.forEach((mesh) => layerState.scene?.add(mesh));

    const { points, uniforms: particleUniforms } = createParticleSystem(exteriorEdges);
    points.userData.visualization = true;
    layerState.particleSystem = points;
    layerState.particleUniforms = particleUniforms;
    layerState.scene.add(points);

    layerState.hoverables = [...roofMeshes, ...wallMeshes];
  }, [data, roofGrids, thermalSurfaces]);

  useEffect(() => {
    rebuildSceneRef.current = rebuildScene;
  }, [rebuildScene]);

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
          layerState.roofUniforms.uTime.value = performance.now() * 0.0004;
          layerState.roofUniforms.uOverlayMode.value =
            overlay === "solar" ? 0 : overlay === "thermal" ? 1 : 2;
        }

        layerState.wallUniforms.forEach((uniforms) => {
          uniforms.uTime.value = performance.now() * 0.0006;
          uniforms.uVisible.value = overlay === "solar" ? 0.04 : 0.62;
        });

        if (hoverDirtyRef.current && layerState.raycaster) {
          layerState.raycaster.setFromCamera(mouseRef.current, layerState.camera);
          const intersections = layerState.raycaster.intersectObjects(layerState.hoverables, false);
          const hit = intersections[0];
          const hoverRoofGrids = layerState.displayRoofGrids ?? roofGrids;
          const nextHover =
            hit && hit.uv
              ? createHoverDetail(
                  thermalSurfaces,
                  hoverRoofGrids.solarGrid,
                  hoverRoofGrids.coverageGrid,
                  hoverRoofGrids.confidenceGrid,
                  hit.object,
                  hit.uv,
                )
              : null;
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
  }, [data, onHoverChange, overlay, particlesEnabled, rebuildScene, roofGrids, thermalSurfaces]);

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
