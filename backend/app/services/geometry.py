import math
import requests
from typing import List, Dict, Any, Tuple
from shapely.geometry import Polygon
from shapely.ops import triangulate

from ..schemas import SceneBuilding, LocalPoint, MeshGeometry, BuildingProfile


def get_rectangle_footprint(square_feet: int, floors: int) -> List[LocalPoint]:
    area_meters2 = max(60.0, (square_feet / max(1, floors)) * 0.092903)
    aspect = 1.45
    length = math.sqrt(area_meters2 * aspect)
    width = area_meters2 / length
    half_length = length / 2
    half_width = width / 2
    return [
        LocalPoint(x=-half_length, z=-half_width),
        LocalPoint(x=half_length, z=-half_width),
        LocalPoint(x=half_length, z=half_width),
        LocalPoint(x=-half_length, z=half_width)
    ]


def to_mercator(lng: float, lat: float) -> Tuple[float, float]:
    r = 6378137.0
    x = r * math.radians(lng)
    y = r * math.log(math.tan(math.pi / 4.0 + math.radians(lat) / 2.0))
    return x, y


def fetch_osm_footprint(lat: float, lng: float) -> List[LocalPoint] | None:
    overpass_url = "http://overpass-api.de/api/interpreter"
    query = f"""
    [out:json];
    way["building"](around:35, {lat}, {lng});
    (._;>;);
    out body;
    """
    try:
        response = requests.post(overpass_url, data={'data': query}, timeout=3)
        if response.status_code != 200:
            return None
        data = response.json()
        nodes = {node["id"]: node for node in data.get("elements", []) if node["type"] == "node"}
        ways = [way for way in data.get("elements", []) if way["type"] == "way"]
        if not ways:
            return None
        
        # Take the first building way 
        way = ways[0]
        points = []
        center_x, center_y = to_mercator(lng, lat)
        
        for node_id in way.get("nodes", []):
            if node_id in nodes:
                node = nodes[node_id]
                x, y = to_mercator(node["lon"], node["lat"])
                # Local coords (X is east, Z is north theoretically, but match standard)
                lx = x - center_x
                lz = -(y - center_y)
                points.append(LocalPoint(x=lx, z=lz))
                
        if len(points) >= 3:
            # remove last point if it's identical to first
            if points[0].x == points[-1].x and points[0].z == points[-1].z:
                points.pop()
            return points
    except Exception:
        pass
    
    return None


def generate_roof_mesh(footprint: List[LocalPoint]) -> MeshGeometry:
    if len(footprint) < 3:
        return MeshGeometry(vertices=[], indices=[], normals=[])
        
    poly = Polygon([(p.x, p.z) for p in footprint])
    if not poly.is_valid:
        poly = poly.buffer(0)
        
    triangles = triangulate(poly)
    # Filter triangles that are not inside the polygon (useful for concave)
    valid_triangles = [t for t in triangles if poly.contains(t.centroid) or poly.intersection(t).area > 0.99 * t.area]
    
    vertices = []
    indices = []
    normals = []
    
    vertex_map = {}
    current_index = 0
    
    for t in valid_triangles:
        coords = list(t.exterior.coords)[:3]
        tri_indices = []
        for x, z in coords:
            key = (round(x, 4), round(z, 4))
            if key not in vertex_map:
                vertex_map[key] = current_index
                vertices.extend([x, 0.0, z])
                normals.extend([0.0, 1.0, 0.0])
                current_index += 1
            tri_indices.append(vertex_map[key])
            
        indices.extend(tri_indices)
        
    return MeshGeometry(vertices=vertices, indices=indices, normals=normals)


class BuildingMeshBuilder:
    @staticmethod
    def build(building: BuildingProfile) -> SceneBuilding:
        height_m = max(1, building.floors) * 3.7 + 1.8
        
        footprint = fetch_osm_footprint(building.lat, building.lng)
        if not footprint:
            footprint = get_rectangle_footprint(building.squareFeet, building.floors)
            
        roof_mesh = generate_roof_mesh(footprint)
        
        return SceneBuilding(
            origin={"lng": building.lng, "lat": building.lat},
            height_m=height_m,
            footprint=footprint,
            roofMesh=roof_mesh
        )
