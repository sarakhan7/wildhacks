import math
from typing import List, Dict, Any, Tuple
from ..schemas import SceneThermal, VisualizationSurface, ParticleEmitter, LocalPoint, AnalysisResults, BuildingProfile

ROOF_GRID = {"cols": 32, "rows": 32}
WALL_GRID = {"cols": 16, "rows": 8}


def describe_envelope_vintage(year_built: int, has_renovations: bool) -> str:
    if has_renovations:
        return "renovated"
    if year_built >= 2016:
        return "high_performance"
    if year_built >= 2000:
        return "modern"
    if year_built >= 1980:
        return "post_1980"
    if year_built >= 1960:
        return "mid_century"
    return "legacy"


def get_envelope_factors(vintage_band: str) -> Dict[str, float]:
    if vintage_band == "high_performance":
        return {"roof": 0.72, "wall": 0.68, "infiltration": 0.55}
    elif vintage_band == "modern":
        return {"roof": 0.84, "wall": 0.82, "infiltration": 0.7}
    elif vintage_band == "post_1980":
        return {"roof": 0.96, "wall": 0.95, "infiltration": 0.84}
    elif vintage_band == "mid_century":
        return {"roof": 1.12, "wall": 1.06, "infiltration": 1.04}
    elif vintage_band == "renovated":
        return {"roof": 0.8, "wall": 0.78, "infiltration": 0.64}
    else:
        return {"roof": 1.24, "wall": 1.14, "infiltration": 1.16}


def create_patch_values(cols: int, rows: int, base_intensity: float, wave: Dict[str, float]) -> List[float]:
    values = []
    bias = wave.get("bias", 0.0)
    for row in range(rows):
        for col in range(cols):
            nx = 0.5 if cols == 1 else col / (cols - 1)
            ny = 0.5 if rows == 1 else row / (rows - 1)
            ripple = (
                math.sin((nx + bias) * math.pi * wave["x"]) * 0.18 +
                math.cos((ny + bias) * math.pi * wave["y"]) * 0.14 +
                math.sin((nx + ny) * math.pi * 2.2) * 0.08
            )
            values.append(round(base_intensity * (1.0 + ripple), 4))
    return values


def create_surface(kind: str, patch_grid: Dict[str, int], flux: float, wave: Dict[str, float]) -> VisualizationSurface:
    base_intensity = abs(flux)
    patch_values = create_patch_values(patch_grid["cols"], patch_grid["rows"], base_intensity, wave)
    peak = max(patch_values) if patch_values else 0.0
    normalized_intensity = round(min(1.0, peak / 42.0), 4)
    
    emitter_rate = round(max(0.0, flux) * (4.8 if kind == "roof" else 3.6), 2)
    direction = "outward" if flux >= 0 else "inward"
    
    return VisualizationSurface(
        id=kind,
        kind=kind,
        patchGrid=patch_grid,
        baseFluxWm2=round(flux, 3),
        normalizedIntensity=normalized_intensity,
        emitterRate=emitter_rate,
        direction=direction,
        patchValues=patch_values
    )


def compute_occupancy_gain_factor(analysis: AnalysisResults, building: BuildingProfile) -> float:
    occupancy_factor = 0.8 + getattr(building, "occupancy", 100) / 250.0
    schedule_factor = 0.85 + min(1.0, getattr(building, "operatingHours", 0) / 60.0) * 0.35
    cooling_factor = 0.75 + getattr(analysis, "coolingPercent", 0.0) / 100.0
    return occupancy_factor * schedule_factor * cooling_factor


class ThermalModelService:
    @staticmethod
    def build(building: BuildingProfile, analysis: AnalysisResults, weather: List[Any], footprint: List[LocalPoint], height_m: float) -> SceneThermal:
        vintage_band = describe_envelope_vintage(building.yearBuilt, building.hasRenovations)
        envelope_factors = get_envelope_factors(vintage_band)
        
        avg_hdd = sum(w.hdd for w in weather) / max(len(weather), 1)
        avg_cdd = sum(w.cdd for w in weather) / max(len(weather), 1)
        climate_swing = 0.7 + (avg_hdd + avg_cdd) / 120.0
        
        occupancy_gain = compute_occupancy_gain_factor(analysis, building)
        heating_pressure = getattr(analysis, "heatingPercent", 0.0) / 100.0
        cooling_pressure = getattr(analysis, "coolingPercent", 0.0) / 100.0
        baseload_pressure = max(0.25, getattr(analysis, "baseloadPercent", 0.0) / 100.0)
        
        roof_flux = (heating_pressure * 22 + cooling_pressure * 14 + baseload_pressure * 5.5) * envelope_factors["roof"] * climate_swing
        north_flux = (heating_pressure * 20 + baseload_pressure * 4.5) * envelope_factors["wall"] * climate_swing
        south_flux = (heating_pressure * 12 + cooling_pressure * 9 + occupancy_gain * 2.2) * envelope_factors["wall"] * (0.92 + climate_swing * 0.08)
        east_flux = (cooling_pressure * 10 + heating_pressure * 7 + occupancy_gain * 1.4) * envelope_factors["wall"] * (0.88 + envelope_factors["infiltration"] * 0.12)
        west_flux = (cooling_pressure * 13 + heating_pressure * 6 + occupancy_gain * 1.8) * envelope_factors["wall"] * (0.96 + envelope_factors["infiltration"] * 0.16)
        
        surfaces = [
            create_surface("roof", ROOF_GRID, roof_flux, {"x": 3.2, "y": 2.5, "bias": 0.18}),
            create_surface("north_wall", WALL_GRID, north_flux, {"x": 1.4, "y": 2.8, "bias": 0.06}),
            create_surface("south_wall", WALL_GRID, south_flux, {"x": 1.8, "y": 3.2, "bias": 0.24}),
            create_surface("east_wall", WALL_GRID, east_flux, {"x": 2.4, "y": 2.6, "bias": 0.41}),
            create_surface("west_wall", WALL_GRID, west_flux, {"x": 2.7, "y": 2.1, "bias": 0.59})
        ]
        
        # Calculate bounding box from footprint for particle fallback logic
        # (Though future iterations could use exact polygon meshes, for now we mirror the standard bounding volume)
        min_x = min(p.x for p in footprint) if footprint else 0.0
        max_x = max(p.x for p in footprint) if footprint else 0.0
        min_z = min(p.z for p in footprint) if footprint else 0.0
        max_z = max(p.z for p in footprint) if footprint else 0.0
        
        emitters = []
        for surface in surfaces:
            if surface.emitterRate > 0:
                emitters.append(ParticleEmitter(
                    surfaceId=surface.id,
                    rate=surface.emitterRate * 2.0,
                    speed=0.08 + surface.baseFluxWm2 / 120.0
                ))
        
        return SceneThermal(
            source="modeled_envelope",
            surfaces=surfaces,
            assumptions={
                "indoorHeatingSetpointF": 70,
                "indoorCoolingSetpointF": 74,
                "envelopeVintageBand": vintage_band
            },
            particleEmitters=emitters
        )
