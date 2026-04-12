import io
import math
import urllib.parse
import requests
import tifffile
from typing import List, Dict, Any, Optional

from ..schemas import SceneSolar, SolarSegmentStat, VisualizationGrid
from ..config import settings


SOLAR_GRID_SIZE = 32


def get_solar_api_key() -> str:
    return settings.solar_api_key


def fetch_google_json(url: str) -> Dict[str, Any]:
    response = requests.get(url, headers={"Accept": "application/json"}, timeout=10)
    response.raise_for_status()
    return response.json()


def fetch_geotiff_grid(url: str, key: str) -> Dict[str, Any]:
    parsed = urllib.parse.urlparse(url)
    qs = urllib.parse.parse_qs(parsed.query)
    qs['key'] = [key]
    new_query = urllib.parse.urlencode(qs, doseq=True)
    new_url = urllib.parse.urlunparse(parsed._replace(query=new_query))
    
    response = requests.get(new_url, timeout=10)
    response.raise_for_status()
    
    with tifffile.TiffFile(io.BytesIO(response.content)) as tif:
        image = tif.pages[0]
        data = image.asarray()
        
    width = image.shape[1] if len(image.shape) > 1 else image.shape[0]
    height = image.shape[0] if len(image.shape) > 1 else 1
    
    # If it has bands, shape might be (height, width, bands) or (bands, height, width)
    # Typically for solar API it's a single band 2D array or (bands, height, width).
    if len(image.shape) == 3:
        if image.shape[2] < image.shape[0]:
            bands = [data[:, :, i].flatten().tolist() for i in range(image.shape[2])]
        else:
            bands = [data[i, :, :].flatten().tolist() for i in range(image.shape[0])]
    else:
        bands = [data.flatten().tolist()]
        
    return {
        "width": width,
        "height": height,
        "bands": bands
    }


def downsample_grid(
    source: List[float],
    width: int,
    height: int,
    target_width: int,
    target_height: int,
    mask: Optional[List[float]] = None
) -> VisualizationGrid:
    values = []
    
    for row in range(target_height):
        y0 = math.floor((row / target_height) * height)
        y1 = max(y0 + 1, math.floor(((row + 1) / target_height) * height))
        for col in range(target_width):
            x0 = math.floor((col / target_width) * width)
            x1 = max(x0 + 1, math.floor(((col + 1) / target_width) * width))
            
            total_sum = 0.0
            count = 0
            for y in range(y0, y1):
                for x in range(x0, x1):
                    idx = y * width + x
                    if mask is not None and mask[idx] <= 0:
                        continue
                    val = source[idx]
                    if not math.isfinite(val):
                        continue
                    total_sum += val
                    count += 1
            
            values.append(round(total_sum / count, 4) if count > 0 else 0.0)
            
    return VisualizationGrid(width=target_width, height=target_height, values=values)


def build_fallback_solar(building: Any) -> SceneSolar:
    floors = getattr(building, "floors", 1) or 1
    square_feet = getattr(building, "squareFeet", 1000)
    lat = getattr(building, "lat", 0.0)
    
    roof_area = max(40.0, (square_feet / max(1, floors)) * 0.092903)
    lat_bias = max(0.5, 1.0 - abs(lat - 37) / 40.0)
    
    annual_values = []
    mask_values = []
    
    for row in range(SOLAR_GRID_SIZE):
        for col in range(SOLAR_GRID_SIZE):
            nx = col / (SOLAR_GRID_SIZE - 1)
            ny = row / (SOLAR_GRID_SIZE - 1)
            radial = 1.0 - math.hypot(nx - 0.5, ny - 0.5) * 1.25
            ripple = math.sin(nx * math.pi * 2.2) * 0.08 + math.cos(ny * math.pi * 2.8) * 0.06
            val = max(0, radial + ripple) * 850 * lat_bias + 320
            annual_values.append(round(val, 3))
            mask_values.append(1.0 if (0.08 < nx < 0.92 and 0.08 < ny < 0.92) else 0.0)

    annual_flux_grid = VisualizationGrid(width=SOLAR_GRID_SIZE, height=SOLAR_GRID_SIZE, values=annual_values)
    roof_mask_grid = VisualizationGrid(width=SOLAR_GRID_SIZE, height=SOLAR_GRID_SIZE, values=mask_values)
    
    monthly_flux_grids = []
    for month in range(1, 13):
        m_vals = [round(v * (0.72 + math.sin((month / 12) * math.pi) * 0.2), 4) for v in annual_values]
        monthly_flux_grids.append({
            "month": month,
            "width": SOLAR_GRID_SIZE,
            "height": SOLAR_GRID_SIZE,
            "values": m_vals
        })
        
    return SceneSolar(
        source="modeled_fallback",
        imageryDate=None,
        imageryProcessedDate=None,
        roofStats={
            "areaMeters2": round(roof_area, 2),
            "groundAreaMeters2": round(roof_area * 0.78, 2),
            "sunshineQuantiles": [420, 560, 680, 780, 900, 1020, 1120, 1210, 1310, 1410, 1500],
            "maxArrayPanelsCount": round(roof_area / 2.1),
            "maxArrayAreaMeters2": round(roof_area * 0.72, 2),
            "maxSunshineHoursPerYear": round(1180 * lat_bias, 2),
            "estimatedAnnualKwh": round(roof_area * 22),
            "estimatedAnnualSavingsUsd": round(roof_area * 3.4),
        },
        roofSegmentStats=[],
        annualFluxGrid=annual_flux_grid,
        monthlyFluxGrids=monthly_flux_grids,
        roofMaskGrid=roof_mask_grid
    )


class SolarOverlayBuilder:
    @staticmethod
    def build(building: Any) -> SceneSolar:
        key = get_solar_api_key()
        if not key:
            return build_fallback_solar(building)
            
        lat = getattr(building, "lat", 0.0)
        lng = getattr(building, "lng", 0.0)
        
        base_params = urllib.parse.urlencode({
            "key": key,
            "location.latitude": lat,
            "location.longitude": lng,
            "requiredQuality": "HIGH"
        })
        
        try:
            insights = fetch_google_json(f"https://solar.googleapis.com/v1/buildingInsights:findClosest?{base_params}")
            
            layer_params = urllib.parse.urlencode({
                "key": key,
                "location.latitude": lat,
                "location.longitude": lng,
                "radiusMeters": "45",
                "view": "FULL_LAYERS",
                "requiredQuality": "HIGH",
                "exactQualityRequired": "true",
                "pixelSizeMeters": "0.5"
            })
            
            layers = fetch_google_json(f"https://solar.googleapis.com/v1/dataLayers:get?{layer_params}")
            
            annual_url = layers.get("annualFluxUrl")
            monthly_url = layers.get("monthlyFluxUrl")
            mask_url = layers.get("maskUrl")
            
            if not annual_url or not monthly_url or not mask_url:
                return build_fallback_solar(building)
                
            annual = fetch_geotiff_grid(annual_url, key)
            monthly = fetch_geotiff_grid(monthly_url, key)
            mask = fetch_geotiff_grid(mask_url, key)
            
            mask_band = mask["bands"][0]
            annual_flux_grid = downsample_grid(annual["bands"][0], annual["width"], annual["height"], SOLAR_GRID_SIZE, SOLAR_GRID_SIZE, mask_band)
            roof_mask_grid = downsample_grid(mask_band, mask["width"], mask["height"], SOLAR_GRID_SIZE, SOLAR_GRID_SIZE)
            
            monthly_flux_grids = []
            for i, band in enumerate(monthly["bands"][:12]):
                mg = downsample_grid(band, monthly["width"], monthly["height"], SOLAR_GRID_SIZE, SOLAR_GRID_SIZE, mask_band)
                monthly_flux_grids.append({
                    "month": i + 1,
                    "width": mg.width,
                    "height": mg.height,
                    "values": mg.values
                })
                
            solar_potential = insights.get("solarPotential", {})
            whole_roof = solar_potential.get("wholeRoofStats", {})
            max_sunshine_hours = solar_potential.get("maxSunshineHoursPerYear", 0)
            max_panels = solar_potential.get("maxArrayPanelsCount", 0)
            
            est_annual_kwh = round(max_panels * 375 * (max_sunshine_hours / 1000) * 0.82)
            est_annual_savings = round(est_annual_kwh * 0.14)
            
            segment_stats = []
            for seg in solar_potential.get("roofSegmentStats", []):
                stats = seg.get("stats", {})
                segment_stats.append(SolarSegmentStat(
                    pitchDegrees=round(seg.get("pitchDegrees", 0), 3),
                    azimuthDegrees=round(seg.get("azimuthDegrees", 0), 3),
                    areaMeters2=round(stats.get("areaMeters2", 0), 2),
                    sunshineQuantiles=stats.get("sunshineQuantiles", [])
                ))
                
            return SceneSolar(
                source="google_solar",
                imageryDate=layers.get("imageryDate") or insights.get("imageryDate"),
                imageryProcessedDate=layers.get("imageryProcessedDate"),
                roofStats={
                    "areaMeters2": round(whole_roof.get("areaMeters2", 0), 2),
                    "groundAreaMeters2": round(whole_roof.get("groundAreaMeters2", 0), 2),
                    "sunshineQuantiles": whole_roof.get("sunshineQuantiles", []),
                    "maxArrayPanelsCount": max_panels,
                    "maxArrayAreaMeters2": round(solar_potential.get("maxArrayAreaMeters2", 0), 2),
                    "maxSunshineHoursPerYear": round(max_sunshine_hours, 2),
                    "estimatedAnnualKwh": est_annual_kwh,
                    "estimatedAnnualSavingsUsd": est_annual_savings
                },
                roofSegmentStats=segment_stats,
                annualFluxGrid=annual_flux_grid,
                monthlyFluxGrids=monthly_flux_grids,
                roofMaskGrid=roof_mask_grid
            )
            
        except Exception:
            return build_fallback_solar(building)
