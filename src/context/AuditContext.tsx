"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";
import { AnalysisResults, BuildingInfo, UtilityReading } from "../lib/analysis";
import {
  AuditResultsBundle,
  DiagnosticHypothesis,
  ECMRecommendation,
  FinancialProjection,
  PeerClusterAssignment,
  WeatherMonthFeature,
} from "@/lib/audit-api";

type AuditAnomaly = AuditResultsBundle["anomalies"][number];

type Step = "location" | "details" | "systems" | "upload" | "analyzing" | "complete";

interface AuditContextType {
  // Step state
  currentStep: Step;
  setCurrentStep: (step: Step) => void;
  
  // Data state
  buildingInfo: BuildingInfo;
  setBuildingInfo: (info: Partial<BuildingInfo>) => void;
  
  utilityReadings: UtilityReading[];
  setUtilityReadings: (readings: UtilityReading[]) => void;
  
  analysisResults: AnalysisResults | null;
  setAnalysisResults: (results: AnalysisResults | null) => void;
  
  reportMarkdown: string | null;
  setReportMarkdown: (markdown: string | null) => void;

  auditId: string | null;
  setAuditId: (auditId: string | null) => void;

  peerInsights: PeerClusterAssignment | null;
  anomalies: AuditAnomaly[];
  diagnosticHypotheses: DiagnosticHypothesis[];
  recommendations: ECMRecommendation[];
  financialProjections: FinancialProjection[];
  weatherFeatures: WeatherMonthFeature[];
  auditWarnings: string[];
  setAuditResults: (results: AuditResultsBundle) => void;
  
  // Helpers
  resetAudit: () => void;
}

const defaultBuildingInfo: BuildingInfo = {
  address: "",
  lat: 0,
  lng: 0,
  buildingType: "other",
  squareFeet: 0,
  yearBuilt: 0,
  floors: 0,
  operatingHours: 0,
  hvacType: "packaged_rtu",
  lightingType: "led",
  hasRenovations: false,
  occupancy: 100,
};

const AuditContext = createContext<AuditContextType | undefined>(undefined);

export function AuditProvider({ children }: { children: ReactNode }) {
  const [currentStep, setCurrentStep] = useState<Step>("location");
  const [buildingInfo, setBuildingInfoState] = useState<BuildingInfo>(defaultBuildingInfo);
  const [utilityReadings, setUtilityReadings] = useState<UtilityReading[]>([]);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResults | null>(null);
  const [reportMarkdown, setReportMarkdown] = useState<string | null>(null);
  const [auditId, setAuditId] = useState<string | null>(null);
  const [peerInsights, setPeerInsights] = useState<PeerClusterAssignment | null>(null);
  const [anomalies, setAnomalies] = useState<AuditAnomaly[]>([]);
  const [diagnosticHypotheses, setDiagnosticHypotheses] = useState<DiagnosticHypothesis[]>([]);
  const [recommendations, setRecommendations] = useState<ECMRecommendation[]>([]);
  const [financialProjections, setFinancialProjections] = useState<FinancialProjection[]>([]);
  const [weatherFeatures, setWeatherFeatures] = useState<WeatherMonthFeature[]>([]);
  const [auditWarnings, setAuditWarnings] = useState<string[]>([]);

  const setBuildingInfo = (info: Partial<BuildingInfo>) => {
    setBuildingInfoState(prev => ({ ...prev, ...info }));
  };

  const setAuditResults = (results: AuditResultsBundle) => {
    setAuditId(results.audit_id);
    setUtilityReadings(results.readings);
    setAnalysisResults(results.analysis);
    setReportMarkdown(results.report?.markdown || null);
    setPeerInsights(results.peer);
    setAnomalies(results.anomalies);
    setDiagnosticHypotheses(results.diagnostics);
    setRecommendations(results.recommendations);
    setFinancialProjections(results.financials);
    setWeatherFeatures(results.weather);
    setAuditWarnings(results.warnings);
  };

  const resetAudit = () => {
    setCurrentStep("location");
    setBuildingInfoState(defaultBuildingInfo);
    setUtilityReadings([]);
    setAnalysisResults(null);
    setReportMarkdown(null);
    setAuditId(null);
    setPeerInsights(null);
    setAnomalies([]);
    setDiagnosticHypotheses([]);
    setRecommendations([]);
    setFinancialProjections([]);
    setWeatherFeatures([]);
    setAuditWarnings([]);
  };

  return (
    <AuditContext.Provider
      value={{
        currentStep,
        setCurrentStep,
        buildingInfo,
        setBuildingInfo,
        utilityReadings,
        setUtilityReadings,
        analysisResults,
        setAnalysisResults,
        reportMarkdown,
        setReportMarkdown,
        auditId,
        setAuditId,
        peerInsights,
        anomalies,
        diagnosticHypotheses,
        recommendations,
        financialProjections,
        weatherFeatures,
        auditWarnings,
        setAuditResults,
        resetAudit,
      }}
    >
      {children}
    </AuditContext.Provider>
  );
}

export function useAudit() {
  const context = useContext(AuditContext);
  if (context === undefined) {
    throw new Error("useAudit must be used within an AuditProvider");
  }
  return context;
}
