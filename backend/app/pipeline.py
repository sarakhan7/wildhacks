from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from .analytics.anomaly import detect_anomalies
from .analytics.peer import PeerClusterService
from .analytics.prism import (
    KWH_TO_KBTU,
    THERMS_TO_KBTU,
    estimate_prism_components,
    fit_prism_model,
    fit_prism_series,
)
from .repository import AuditRepository
from .schemas import (
    AnalysisResults,
    AuditResultsResponse,
    BuildingProfile,
    ChangepointSignal,
    MonthlyBreakdown,
    NormalizedUtilityReading,
    OCRDocumentResult,
    OCRReading,
)
from .services.ocr import OCRService
from .schemas import UploadedDocument
from .services.reasoning import ReasoningService
from .services.weather import WeatherService


class AuditPipeline:
    def __init__(
        self,
        repository: AuditRepository,
        ocr_service: OCRService,
        weather_service: WeatherService,
        reasoning_service: ReasoningService,
        peer_service: PeerClusterService,
    ) -> None:
        self.repository = repository
        self.ocr_service = ocr_service
        self.weather_service = weather_service
        self.reasoning_service = reasoning_service
        self.peer_service = peer_service

    def run(self, audit_id: str) -> None:
        building = self.repository.get_building(audit_id)
        warnings: list[str] = []
        try:
            self.repository.update_status(audit_id, status="running", stage="ocr", progress=10)
            documents = self.repository.list_documents(audit_id)
            raw_readings = self._extract_documents(documents)
            self.repository.save_raw_readings(audit_id, raw_readings)

            self.repository.update_status(audit_id, status="running", stage="normalize", progress=25)
            normalized = self._normalize_readings(raw_readings, warnings)
            if not normalized:
                if documents:
                    if any(self._is_image_document(document) for document in documents):
                        raise RuntimeError(
                            "No utility data could be extracted from the uploaded images. "
                            "Configure GEMINI_API_KEY for image OCR, or upload embedded-text PDFs."
                        )
                    raise RuntimeError("No utility data could be extracted from the uploaded files.")
                normalized = self._build_demo_readings()
                warnings.append("No files were uploaded. Demo readings were generated so the pipeline could complete.")
            self.repository.save_normalized_readings(audit_id, normalized)

            self.repository.update_status(audit_id, status="running", stage="weather", progress=40, warnings=warnings)
            weather = self.weather_service.build_monthly_features(building, [reading.month for reading in normalized])
            self.repository.save_weather(audit_id, weather)

            self.repository.update_status(audit_id, status="running", stage="analytics", progress=60, warnings=warnings)
            anomalies = detect_anomalies(normalized, weather)
            anomaly_months = set()
            if self._should_exclude_anomalies_from_prism(normalized):
                anomaly_months = {signal.month for signal in anomalies if signal.flagged}
            prism = fit_prism_model(normalized, weather, anomaly_months)
            peer = self.peer_service.assign(building, self._compute_site_eui(normalized, building), self.weather_service.derive_climate_zone(building))
            analysis = self._build_analysis(building, normalized, weather, prism, anomalies, peer, anomaly_months)
            self.repository.save_peer_assignment(audit_id, peer)
            self.repository.save_analysis(audit_id, analysis)

            self.repository.update_status(
                audit_id,
                status="running",
                stage="diagnostics",
                progress=75,
                warnings=warnings,
                metadata={"anomalies": [signal.model_dump() for signal in anomalies]},
            )
            hypotheses = self.reasoning_service.diagnose(building, analysis, peer, anomalies)
            self.repository.save_hypotheses(audit_id, hypotheses)

            self.repository.update_status(
                audit_id,
                status="running",
                stage="recommendations",
                progress=88,
                warnings=warnings,
                metadata={"anomalies": [signal.model_dump() for signal in anomalies]},
            )
            recommendations, financials = self.reasoning_service.recommend(building, analysis, peer, hypotheses, anomalies)
            self.repository.save_recommendations(audit_id, recommendations)
            self.repository.save_financials(audit_id, financials)

            self.repository.update_status(
                audit_id,
                status="running",
                stage="report",
                progress=95,
                warnings=warnings,
                metadata={"anomalies": [signal.model_dump() for signal in anomalies]},
            )
            report = self.reasoning_service.write_report(
                building,
                analysis,
                peer,
                anomalies,
                hypotheses,
                recommendations,
                financials,
            )
            self.repository.save_report(audit_id, report)

            needs_review = any(reading.confidence < 0.55 for reading in normalized)
            self.repository.update_status(
                audit_id,
                status="needs_review" if needs_review else "completed",
                stage="needs_review" if needs_review else "completed",
                progress=100,
                warnings=warnings,
                metadata={"anomalies": [signal.model_dump() for signal in anomalies]},
            )
        except Exception as exc:
            self.repository.update_status(audit_id, status="failed", stage="failed", progress=100, warnings=warnings, error=str(exc))
            raise

    def rerun_from_review(self, audit_id: str) -> None:
        self.run(audit_id)

    def _extract_documents(self, documents: list[UploadedDocument]) -> list[OCRReading]:
        readings: list[OCRReading] = []
        for document in documents:
            result = self.ocr_service.extract(document)
            readings.extend(result.readings)
        return readings

    def _is_image_document(self, document: UploadedDocument) -> bool:
        mime_type = (document.mime_type or "").lower()
        filename = document.filename.lower()
        return mime_type.startswith("image/") or filename.endswith((".png", ".jpg", ".jpeg", ".webp"))

    def _normalize_readings(self, readings: list[OCRReading], warnings: list[str]) -> list[NormalizedUtilityReading]:
        deduped: dict[str, NormalizedUtilityReading] = {}
        for reading in readings:
            entry = NormalizedUtilityReading(
                month=reading.month,
                kwh=max(0, round(reading.kwh, 2)),
                therms=max(0, round(reading.therms, 2)),
                peak_kw=round(reading.peak_kw, 2) if reading.peak_kw is not None else None,
                cost=max(0, round(reading.cost, 2)),
                confidence=reading.confidence,
                warnings=list(reading.extraction_notes),
                source_document_ids=[reading.source_document_id],
            )
            previous = deduped.get(entry.month)
            if previous is None or entry.confidence >= previous.confidence:
                deduped[entry.month] = entry
        normalized = [deduped[month] for month in sorted(deduped)]
        if len(normalized) < 12:
            warnings.append(f"Only {len(normalized)} months of readings were extracted; regression quality may be limited.")
        return normalized

    def _build_demo_readings(self) -> list[NormalizedUtilityReading]:
        months = []
        for month_num in range(1, 13):
            is_summer = month_num in {6, 7, 8, 9}
            is_winter = month_num in {1, 2, 3, 11, 12}
            months.append(
                NormalizedUtilityReading(
                    month=f"2025-{month_num:02d}",
                    kwh=9000 + (3200 if is_summer else 0),
                    therms=120 + (280 if is_winter else 0),
                    peak_kw=18 + (4 if is_summer else 0),
                    cost=1400 + (350 if is_summer or is_winter else 0),
                    confidence=0.2,
                    warnings=["Generated demo reading"],
                    source_document_ids=[],
                )
            )
        return months

    def _should_exclude_anomalies_from_prism(self, readings: list[NormalizedUtilityReading]) -> bool:
        # Keep anomaly detection/reporting for demo runs, but avoid removing the synthetic
        # seasonal months from PRISM because the generated dataset is intentionally stylized.
        return not all(
            not reading.source_document_ids and "Generated demo reading" in reading.warnings
            for reading in readings
        )

    def _compute_site_eui(self, readings: list[NormalizedUtilityReading], building: BuildingProfile) -> float:
        total_energy = sum((reading.kwh * KWH_TO_KBTU) + (reading.therms * THERMS_TO_KBTU) for reading in readings)
        return total_energy / max(building.squareFeet, 1)

    def _build_analysis(
        self,
        building: BuildingProfile,
        readings: list[NormalizedUtilityReading],
        weather,
        prism,
        anomalies: list[ChangepointSignal],
        peer,
        anomaly_months: set[str],
    ) -> AnalysisResults:
        flagged_months = {signal.month for signal in anomalies if signal.flagged}
        monthly_breakdown: list[MonthlyBreakdown] = []
        total_electricity = 0.0
        total_gas = 0.0
        total_cost = 0.0
        total_energy = 0.0
        for reading in readings:
            electric_kbtu = reading.kwh * KWH_TO_KBTU
            gas_kbtu = reading.therms * THERMS_TO_KBTU
            total_kbtu = electric_kbtu + gas_kbtu
            total_electricity += reading.kwh
            total_gas += reading.therms
            total_cost += reading.cost
            total_energy += total_kbtu
            monthly_breakdown.append(
                MonthlyBreakdown(
                    month=reading.month,
                    label=reading.month,
                    electricKbtu=round(electric_kbtu, 2),
                    gasKbtu=round(gas_kbtu, 2),
                    totalKbtu=round(total_kbtu, 2),
                    cost=reading.cost,
                    isAnomaly=reading.month in flagged_months,
                )
            )

        peak = max(monthly_breakdown, key=lambda row: row.totalKbtu)
        low = min(monthly_breakdown, key=lambda row: row.totalKbtu)
        seasonal_variation = peak.totalKbtu / max(low.totalKbtu, 1)

        modeled_months = [reading.month for reading in readings if reading.month not in anomaly_months]
        weighted_rows = [(reading.month, reading.kwh * KWH_TO_KBTU, max(reading.confidence, 0.25)) for reading in readings]
        electric_prism = fit_prism_series(weighted_rows, weather, anomaly_months)
        gas_rows = [(reading.month, reading.therms * THERMS_TO_KBTU, max(reading.confidence, 0.25)) for reading in readings]
        gas_prism = fit_prism_series(gas_rows, weather, anomaly_months)

        electric_baseload, electric_heating, electric_cooling = estimate_prism_components(electric_prism, weather, modeled_months)
        gas_baseload, gas_heating, _gas_cooling = estimate_prism_components(gas_prism, weather, modeled_months)

        electric_actual = sum(reading.kwh * KWH_TO_KBTU for reading in readings if reading.month in modeled_months)
        gas_actual = sum(reading.therms * THERMS_TO_KBTU for reading in readings if reading.month in modeled_months)

        electric_baseload, electric_heating, electric_cooling = self._scale_components_to_total(
            electric_baseload,
            electric_heating,
            electric_cooling,
            electric_actual,
        )
        gas_baseload, gas_heating = self._scale_two_components_to_total(
            gas_baseload,
            gas_heating,
            gas_actual,
        )

        baseload_total = electric_baseload + gas_baseload
        heating_total = electric_heating + gas_heating
        cooling_total = electric_cooling
        assigned_total = baseload_total + heating_total + cooling_total
        residual = max(0.0, total_energy - assigned_total)
        baseload_total += residual

        baseload_percent = (baseload_total / max(total_energy, 1)) * 100
        heating_percent = (heating_total / max(total_energy, 1)) * 100
        cooling_percent = (cooling_total / max(total_energy, 1)) * 100
        peak_kw_values = [reading.peak_kw for reading in readings if reading.peak_kw is not None]
        avg_demand = total_electricity / max(len(readings) * 730, 1)
        load_factor = avg_demand / max(max(peak_kw_values), 1) if peak_kw_values else None
        site_eui = total_energy / max(building.squareFeet, 1)
        excess_cost = max(0.0, (site_eui - peer.median_eui) * building.squareFeet * (total_cost / max(total_energy, 1)))
        annual_savings = min(total_cost * 0.30, excess_cost * 0.40)

        return AnalysisResults(
            totalElectricity=round(total_electricity, 2),
            totalGas=round(total_gas, 2),
            totalEnergy=round(total_energy, 2),
            totalCost=round(total_cost, 2),
            siteEUI=round(site_eui, 2),
            costPerSqFt=round(total_cost / max(building.squareFeet, 1), 2),
            electricIntensity=round(total_electricity / max(building.squareFeet, 1), 2),
            gasIntensity=round(total_gas / max(building.squareFeet, 1), 2),
            loadFactor=round(load_factor, 3) if load_factor is not None else None,
            monthlyBreakdown=monthly_breakdown,
            peakMonth=peak.label,
            lowestMonth=low.label,
            seasonalVariation=round(seasonal_variation, 2),
            estimatedBaseload=round(baseload_total / max(len(readings), 1), 2),
            heatingPercent=round(max(0.0, heating_percent), 1),
            coolingPercent=round(max(0.0, cooling_percent), 1),
            baseloadPercent=round(max(0.0, baseload_percent), 1),
            annualSavingsOpportunity=round(max(total_cost * 0.12, annual_savings), 2),
            peerPercentile=peer.percentile,
            clusterLabel=peer.archetype_label,
            climateZone=peer.climate_zone,
            anomalyCount=sum(1 for row in monthly_breakdown if row.isAnomaly),
            prism=prism,
        )

    def _scale_components_to_total(
        self,
        baseload: float,
        heating: float,
        cooling: float,
        actual_total: float,
    ) -> tuple[float, float, float]:
        modeled_total = baseload + heating + cooling
        if modeled_total <= 0 or actual_total <= 0:
            return 0.0, 0.0, 0.0
        scale = actual_total / modeled_total
        return baseload * scale, heating * scale, cooling * scale

    def _scale_two_components_to_total(
        self,
        baseload: float,
        heating: float,
        actual_total: float,
    ) -> tuple[float, float]:
        modeled_total = baseload + heating
        if modeled_total <= 0 or actual_total <= 0:
            return 0.0, 0.0
        scale = actual_total / modeled_total
        return baseload * scale, heating * scale
