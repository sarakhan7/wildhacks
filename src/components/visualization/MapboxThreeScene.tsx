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
  camera: THREE.Camera | null;
  renderer: THREE.WebGLRenderer | null;
  raycaster: THREE.Raycaster | null;
  roofMesh: THREE.Mesh | null;
  wallMeshes: THREE.Mesh[];
  particleSystem: THREE.Points | null;
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
  footprintPoints: LocalPoint[];
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
    footprintPoints: [],
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

function resolveFootprint(map: mapboxgl.Map, data: VisualizationSceneResponse) {
  try {
    const sourceFeatures = map.querySourceFeatures("composite", { sourceLayer: "building" });
    const candidates = sourceFeatures
      .filter((feature) => feature.properties?.extrude === "true" || feature.properties?.extrude === true)
      .map((feature) => ({ ring: extractFeatureRing(feature), feature }))
      .filter((entry): entry is { ring: [number, number][]; feature: mapboxgl.MapboxGeoJSONFeature } => Boolean(entry.ring))
      .filter((entry) => entry.ring.length >= 3);

    if (candidates.length === 0) {
      return getRectangleFootprint(data.building.squareFeet, data.building.floors);
    }

    const nearest = candidates
      .sort(
        (a, b) =>
          distanceToCenter(a.ring, data.building.lng, data.building.lat) -
          distanceToCenter(b.ring, data.building.lng, data.building.lat),
      )[0];

    const footprint = sanitizeFootprint(
      featureCoordinatesToLocal(nearest.ring, data.building.lng, data.building.lat),
    );
    return footprint.length >= 3 ? footprint : getRectangleFootprint(data.building.squareFeet, data.building.floors);
  } catch {
    return getRectangleFootprint(data.building.squareFeet, data.building.floors);
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
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
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
        return mix(vec3(0.05, 0.16, 0.28), vec3(0.98, 0.72, 0.2), smoothstep(0.0, 1.0, t));
      }

      vec3 thermalRamp(float t) {
        return mix(vec3(0.02, 0.18, 0.28), vec3(0.98, 0.34, 0.12), smoothstep(0.0, 1.0, t));
      }

      void main() {
        float mask = texture2D(uMask, vUv).r;
        if (mask < 0.08) discard;
        float solar = texture2D(uSolar, vUv).r;
        float thermal = texture2D(uThermal, vUv).r;
        vec3 solarColor = solarRamp(solar);
        vec3 thermalColor = thermalRamp(thermal);
        vec3 baseColor = uOverlayMode < 0.5 ? solarColor : uOverlayMode < 1.5 ? thermalColor : mix(solarColor, thermalColor, 0.45);
        vec3 lightDir = normalize(vec3(0.4, 0.85, 0.3));
        float shade = 0.55 + max(dot(normalize(vNormal), lightDir), 0.0) * 0.45;
        gl_FragColor = vec4(baseColor * shade, uOpacity);
      }
    `,
  });

  return { material, uniforms };
}

function createWallShaderMaterial(thermalTexture: THREE.DataTexture) {
  const uniforms = {
    uThermal: { value: thermalTexture },
    uVisible: { value: 1 },
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
      uniform sampler2D uThermal;
      uniform float uVisible;
      varying vec2 vUv;
      varying vec3 vNormal;

      vec3 thermalRamp(float t) {
        return mix(vec3(0.03, 0.16, 0.23), vec3(1.0, 0.33, 0.11), smoothstep(0.0, 1.0, t));
      }

      void main() {
        float thermal = texture2D(uThermal, vUv).r;
        vec3 color = thermalRamp(thermal);
        vec3 lightDir = normalize(vec3(0.3, 0.9, 0.28));
        float shade = 0.48 + max(dot(normalize(vNormal), lightDir), 0.0) * 0.4;
        gl_FragColor = vec4(color * shade, uVisible);
      }
    `,
  });

  return { material, uniforms };
}

function createParticleSystem(footprint: LocalPoint[], height: number, thermalSurfaces: ReturnType<typeof applyScenarioToThermal>) {
  const bounds = {
    minX: Math.min(...footprint.map((point) => point.x)),
    maxX: Math.max(...footprint.map((point) => point.x)),
    minZ: Math.min(...footprint.map((point) => point.z)),
    maxZ: Math.max(...footprint.map((point) => point.z)),
  };

  const basePositions: number[] = [];
  const directions: number[] = [];
  const speeds: number[] = [];
  const offsets: number[] = [];
  const intensities: number[] = [];
  const zeros: number[] = [];

  const roof = thermalSurfaces.find((surface) => surface.kind === "roof");
  if (roof) {
    for (let row = 0; row < roof.patchGrid.rows; row += 1) {
      for (let col = 0; col < roof.patchGrid.cols; col += 1) {
        const index = row * roof.patchGrid.cols + col;
        const flux = roof.patchValues[index];
        if (flux <= roof.baseFluxWm2 * 0.72) {
          continue;
        }
        const u = (col + 0.5) / roof.patchGrid.cols;
        const v = (row + 0.5) / roof.patchGrid.rows;
        const x = THREE.MathUtils.lerp(bounds.minX, bounds.maxX, u);
        const z = THREE.MathUtils.lerp(bounds.minZ, bounds.maxZ, v);
        basePositions.push(x, height + 0.15, z);
        directions.push((u - 0.5) * 0.08, 1, (v - 0.5) * 0.08);
        speeds.push(0.08 + flux / 110);
        offsets.push(((row + 1) * (col + 3)) % 19 / 19);
        intensities.push(Math.min(1, flux / 42));
        zeros.push(0, 0, 0);
      }
    }
  }

  thermalSurfaces
    .filter((surface) => surface.kind !== "roof" && surface.baseFluxWm2 > 0)
    .forEach((surface) => {
      const direction =
        surface.kind === "north_wall"
          ? new THREE.Vector3(0, 0.15, -1)
          : surface.kind === "south_wall"
            ? new THREE.Vector3(0, 0.15, 1)
            : surface.kind === "east_wall"
              ? new THREE.Vector3(1, 0.15, 0)
              : new THREE.Vector3(-1, 0.15, 0);

      for (let row = 0; row < surface.patchGrid.rows; row += 1) {
        for (let col = 0; col < surface.patchGrid.cols; col += 1) {
          const index = row * surface.patchGrid.cols + col;
          const flux = surface.patchValues[index];
          if (flux <= surface.baseFluxWm2 * 0.7) {
            continue;
          }
          const u = (col + 0.5) / surface.patchGrid.cols;
          const v = (row + 0.5) / surface.patchGrid.rows;
          const y = THREE.MathUtils.lerp(0.5, height - 0.35, 1 - v);
          let x = 0;
          let z = 0;
          if (surface.kind === "north_wall" || surface.kind === "south_wall") {
            x = THREE.MathUtils.lerp(bounds.minX, bounds.maxX, u);
            z = surface.kind === "north_wall" ? bounds.minZ : bounds.maxZ;
          } else {
            x = surface.kind === "east_wall" ? bounds.maxX : bounds.minX;
            z = THREE.MathUtils.lerp(bounds.minZ, bounds.maxZ, u);
          }
          basePositions.push(x, y, z);
          directions.push(direction.x, direction.y, direction.z);
          speeds.push(0.05 + flux / 130);
          offsets.push(((row + 2) * (col + 5)) % 23 / 23);
          intensities.push(Math.min(1, flux / 38));
          zeros.push(0, 0, 0);
        }
      }
    });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(zeros, 3));
  geometry.setAttribute("basePosition", new THREE.Float32BufferAttribute(basePositions, 3));
  geometry.setAttribute("direction", new THREE.Float32BufferAttribute(directions, 3));
  geometry.setAttribute("speed", new THREE.Float32BufferAttribute(speeds, 1));
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
      attribute float speed;
      attribute float offset;
      attribute float intensity;
      uniform float uTime;
      uniform float uVisible;
      varying float vIntensity;
      void main() {
        float cycle = fract(uTime * speed + offset);
        vec3 animated = basePosition + direction * cycle * (1.4 + intensity * 3.2);
        vec4 mvPosition = modelViewMatrix * vec4(animated, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = (5.0 + intensity * 12.0) * uVisible;
        vIntensity = intensity;
      }
    `,
    fragmentShader: `
      varying float vIntensity;
      void main() {
        float dist = distance(gl_PointCoord, vec2(0.5));
        if (dist > 0.5) discard;
        float alpha = smoothstep(0.5, 0.0, dist) * (0.26 + vIntensity * 0.7);
        vec3 color = mix(vec3(0.99, 0.58, 0.2), vec3(1.0, 0.2, 0.04), vIntensity);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  return {
    points: new THREE.Points(geometry, material),
    uniforms,
  };
}

function buildRoofGeometry(footprint: LocalPoint[], height: number) {
  const shape = new THREE.Shape();
  footprint.forEach((point, index) => {
    if (index === 0) {
      shape.moveTo(point.x, point.z);
    } else {
      shape.lineTo(point.x, point.z);
    }
  });
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape, 12);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, height, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundsTree();
  return geometry;
}

function createWallMesh(
  kind: string,
  start: LocalPoint,
  end: LocalPoint,
  height: number,
  texture: THREE.DataTexture,
) {
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  const geometry = new THREE.PlaneGeometry(length, height, 15, 7);
  const midpoint = new THREE.Vector3((start.x + end.x) / 2, height / 2, (start.z + end.z) / 2);
  const angle = Math.atan2(end.z - start.z, end.x - start.x);
  geometry.computeBoundsTree();

  const { material, uniforms } = createWallShaderMaterial(texture);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(midpoint);
  mesh.rotation.y = -angle + Math.PI / 2;
  mesh.userData.kind = kind;
  return { mesh, uniforms };
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

    const footprint = resolveFootprint(layerState.map, data);
    const height = data.building.inferredHeightMeters;
    layerState.footprintPoints = footprint;

    const roofSolarTexture = createTexture(getMonthlyGrid(data.solar, month), true);
    const roofMaskTexture = createTexture(data.solar.roofMaskGrid, false);
    const roofThermalTexture = createThermalGridTexture(
      thermalSurfaces.find((surface) => surface.kind === "roof") ?? thermalSurfaces[0],
    );

    layerState.roofSolarTexture = roofSolarTexture;
    layerState.roofMaskTexture = roofMaskTexture;
    layerState.roofThermalTexture = roofThermalTexture;

    const roofGeometry = buildRoofGeometry(footprint, height);
    const { material: roofMaterial, uniforms: roofUniforms } = createRoofShaderMaterial(
      roofSolarTexture,
      roofThermalTexture,
      roofMaskTexture,
    );
    const roofMesh = new THREE.Mesh(roofGeometry, roofMaterial);
    roofMesh.userData.kind = "roof";
    roofMesh.userData.visualization = true;
    layerState.roofMesh = roofMesh;
    layerState.roofUniforms = roofUniforms;
    layerState.scene.add(roofMesh);

    const wallMeshes: THREE.Mesh[] = [];
    const wallUniforms: Array<Record<string, THREE.IUniform<unknown>>> = [];
    const wallThermalTextures: Partial<Record<string, THREE.DataTexture>> = {};
    const kinds = ["north_wall", "east_wall", "south_wall", "west_wall"] as const;
    for (let i = 0; i < footprint.length; i += 1) {
      const start = footprint[i];
      const end = footprint[(i + 1) % footprint.length];
      const kind = kinds[i % kinds.length];
      const surface = thermalSurfaces.find((entry) => entry.kind === kind);
      if (!surface) {
        continue;
      }
      const thermalTexture = createThermalGridTexture(surface);
      wallThermalTextures[kind] = thermalTexture;
      const { mesh, uniforms } = createWallMesh(kind, start, end, height, thermalTexture);
      mesh.userData.visualization = true;
      layerState.scene.add(mesh);
      wallMeshes.push(mesh);
      wallUniforms.push(uniforms);
    }
    layerState.wallMeshes = wallMeshes;
    layerState.wallUniforms = wallUniforms;
    layerState.wallThermalTextures = wallThermalTextures;

    const edgeGroup = new THREE.Group();
    [roofMesh, ...wallMeshes].forEach((mesh) => {
      const edges = new THREE.EdgesGeometry(mesh.geometry);
      const lines = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: 0x78ecff, opacity: 0.22, transparent: true }),
      );
      lines.position.copy(mesh.position);
      lines.rotation.copy(mesh.rotation);
      lines.userData.visualization = true;
      edgeGroup.add(lines);
    });
    edgeGroup.userData.visualization = true;
    layerState.scene.add(edgeGroup);

    const { points, uniforms: particleUniforms } = createParticleSystem(footprint, height, thermalSurfaces);
    points.userData.visualization = true;
    layerState.particleSystem = points;
    layerState.particleUniforms = particleUniforms;
    layerState.scene.add(points);

    layerState.hoverables = [roofMesh, ...wallMeshes];
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
        layerState.scene.fog = new THREE.FogExp2(0x08111f, 0.018);
        layerState.camera = new THREE.Camera();
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

        rebuildScene();
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
        mapStyle="mapbox://styles/mapbox/satellite-v9"
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
            "fill-extrusion-color": "#0ea5e9",
            "fill-extrusion-height": ["coalesce", ["to-number", ["get", "height"]], 0],
            "fill-extrusion-base": ["coalesce", ["to-number", ["get", "min_height"]], 0],
            "fill-extrusion-opacity": 0.12,
          }}
        />
      </Map>

      <div className="pointer-events-none absolute inset-0 rounded-[16px] border border-[rgba(255,255,255,0.08)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" />
      <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-[rgba(8,145,178,0.45)] bg-[rgba(8,145,178,0.18)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100">
        {overlay === "both" ? "Solar + Thermal" : overlay === "solar" ? "Solar Roof Flux" : "Thermal Envelope"}
      </div>
    </div>
  );
}
