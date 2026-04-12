from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path
from urllib.request import urlretrieve
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import pandas as pd


MICRODATA_URL = "https://www.eia.gov/consumption/commercial/data/2018/xls/cbecs2018_final_public.csv"
CODEBOOK_URL = "https://www.eia.gov/consumption/commercial/data/2018/xls/2018microdata_codebook.xlsx"


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a reduced CBECS 2018 peer benchmark dataset.")
    parser.add_argument("--microdata", type=Path, help="Path to the official 2018 CBECS public-use CSV.")
    parser.add_argument("--codebook", type=Path, help="Path to the official 2018 CBECS codebook XLSX.")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "cbecs_2018_public_use_peers.csv",
        help="Destination for the reduced peer dataset.",
    )
    parser.add_argument(
        "--download-dir",
        type=Path,
        default=Path("/tmp/cbecs_downloads"),
        help="Directory used when --microdata or --codebook are not provided.",
    )
    args = parser.parse_args()

    microdata_path = args.microdata or _download_if_needed(MICRODATA_URL, args.download_dir)
    codebook_path = args.codebook or _download_if_needed(CODEBOOK_URL, args.download_dir)

    value_maps = _parse_codebook_value_maps(codebook_path, {"PBA", "CENDIV", "PUBCLIM"})
    output_df = _build_reduced_dataset(microdata_path, value_maps)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output_df.to_csv(args.output, index=False, quoting=csv.QUOTE_MINIMAL)
    print(f"Wrote {len(output_df):,} peer rows to {args.output}")


def _download_if_needed(url: str, download_dir: Path) -> Path:
    download_dir.mkdir(parents=True, exist_ok=True)
    destination = download_dir / Path(url).name
    if destination.exists():
        return destination
    urlretrieve(url, destination)
    return destination


def _build_reduced_dataset(microdata_path: Path, value_maps: dict[str, dict[int, str]]) -> pd.DataFrame:
    usecols = ["PBA", "CENDIV", "PUBCLIM", "SQFT", "NFLOOR", "YRCONC", "WKHRS", "OCCUPYP", "FINALWT", "MFBTU"]
    df = pd.read_csv(microdata_path, usecols=usecols)
    df = df[(df["PBA"] != 1) & (df["SQFT"] > 0) & (df["FINALWT"] > 0) & (df["MFBTU"] > 0)].copy()

    df["site_eui"] = df["MFBTU"] / df["SQFT"]
    df["floor_count"] = df["NFLOOR"].map(_normalize_floor_count)
    df["pba_code"] = df["PBA"].astype(int)
    df["cendiv"] = df["CENDIV"].astype(int)
    df["pubclim"] = df["PUBCLIM"].astype(int)
    df["pba_label"] = df["pba_code"].map(value_maps["PBA"])
    df["cendiv_label"] = df["cendiv"].map(value_maps["CENDIV"])
    df["pubclim_label"] = df["pubclim"].map(value_maps["PUBCLIM"])

    reduced = df[
        [
            "pba_code",
            "pba_label",
            "cendiv",
            "cendiv_label",
            "pubclim",
            "pubclim_label",
            "SQFT",
            "floor_count",
            "YRCONC",
            "WKHRS",
            "OCCUPYP",
            "site_eui",
            "FINALWT",
        ]
    ].rename(
        columns={
            "SQFT": "sqft",
            "YRCONC": "year_built_category",
            "WKHRS": "operating_hours",
            "OCCUPYP": "occupancy_pct",
            "FINALWT": "weight",
        }
    )

    reduced["site_eui"] = reduced["site_eui"].round(4)
    reduced["weight"] = reduced["weight"].round(4)
    return reduced


def _parse_codebook_value_maps(codebook_path: Path, variable_names: set[str]) -> dict[str, dict[int, str]]:
    workbook = ZipFile(codebook_path)
    shared_strings = _read_shared_strings(workbook)
    sheet = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
    ns = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

    parsed_rows: list[dict[int, str]] = []
    for row in sheet.findall(".//a:sheetData/a:row", ns):
        parsed_cells: dict[int, str] = {}
        for cell in row.findall("a:c", ns):
            ref = cell.attrib.get("r", "")
            column_index = _column_ref_to_index(ref)
            if column_index is None:
                continue
            value_node = cell.find("a:v", ns)
            if value_node is None:
                continue
            value = value_node.text or ""
            if cell.attrib.get("t") == "s":
                value = shared_strings[int(value)]
            parsed_cells[column_index] = value
        if parsed_cells:
            parsed_rows.append(parsed_cells)

    value_maps: dict[str, dict[int, str]] = {}
    for row in parsed_rows:
        variable_name = row.get(1)
        if variable_name not in variable_names:
            continue
        values_blob = row.get(4, "")
        mapping: dict[int, str] = {}
        for line in values_blob.splitlines():
            match = re.match(r"^\s*(\d+)\s*=\s*(.+?)\s*$", line)
            if match:
                mapping[int(match.group(1))] = match.group(2).strip()
        value_maps[variable_name] = mapping
    missing = variable_names - set(value_maps)
    if missing:
        raise RuntimeError(f"Failed to parse codebook mappings for: {sorted(missing)}")
    return value_maps


def _read_shared_strings(workbook: ZipFile) -> list[str]:
    ns = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
    shared: list[str] = []
    for string_item in root.findall("a:si", ns):
        text = "".join(node.text or "" for node in string_item.findall(".//a:t", ns))
        shared.append(text)
    return shared


def _column_ref_to_index(ref: str) -> int | None:
    letters = "".join(ch for ch in ref if ch.isalpha())
    if not letters:
        return None
    index = 0
    for letter in letters:
        index = index * 26 + (ord(letter.upper()) - 64)
    return index - 1


def _normalize_floor_count(value: float) -> int:
    raw = int(value)
    if raw == 994:
        return 12
    if raw == 995:
        return 18
    return max(1, raw)


if __name__ == "__main__":
    main()
