"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";
import { AnalysisResults, BuildingInfo, UtilityReading } from "../lib/analysis";

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
  
  // Helpers
  resetAudit: () => void;
}

const defaultBuildingInfo: BuildingInfo = {
  address: "",
  lat: 0,
  lng: 0,
  buildingType: "office",
  squareFeet: 0,
  yearBuilt: new Date().getFullYear() - 20,
  floors: 1,
  operatingHours: 40,
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

  const setBuildingInfo = (info: Partial<BuildingInfo>) => {
    setBuildingInfoState(prev => ({ ...prev, ...info }));
  };

  const resetAudit = () => {
    setCurrentStep("location");
    setBuildingInfoState(defaultBuildingInfo);
    setUtilityReadings([]);
    setAnalysisResults(null);
    setReportMarkdown(null);
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
